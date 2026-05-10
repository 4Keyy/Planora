using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Validation;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Infrastructure.Logging;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Builder;
using Grpc.Core;
using System.Diagnostics;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;
using DomainExceptions = Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.BuildingBlocks.Infrastructure.Middleware;

/// <summary>
/// Unified global exception handler middleware that converts all exceptions
/// into structured ProblemDetails responses with proper logging and security.
/// </summary>
public sealed class EnhancedGlobalExceptionHandlerMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<EnhancedGlobalExceptionHandlerMiddleware> _logger;

    public EnhancedGlobalExceptionHandlerMiddleware(
        RequestDelegate next,
        ILogger<EnhancedGlobalExceptionHandlerMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var stopwatch = Stopwatch.StartNew();
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            stopwatch.Stop();
            await HandleExceptionAsync(context, ex, stopwatch.ElapsedMilliseconds);
        }
    }

    private Task HandleExceptionAsync(HttpContext context, Exception exception, long elapsedMs)
    {
        context.Response.ContentType = "application/problem+json";

        var traceId = CorrelationIdContext.GetCorrelationId() ?? context.TraceIdentifier;
        var instance = $"{context.Request.Method} {context.Request.Path}";
        var userId = context.User?.FindFirst("sub")?.Value;

        try
        {
            var problemContext = MapExceptionToProblemContext(exception, traceId, instance, userId, elapsedMs);
            LogException(exception, problemContext);
            return WriteProblemDetailsAsync(context, problemContext);
        }
        catch (Exception logEx)
        {
            _logger.LogCritical(logEx, "Failed to handle exception - critical error");
            return WriteUnsafeErrorAsync(context, traceId);
        }
    }

    private DomainExceptions.ProblemDetailsContext MapExceptionToProblemContext(
        Exception exception,
        string traceId,
        string instance,
        string? userId,
        long elapsedMs)
    {
        return exception switch
        {
            // OperationCanceledException (including TaskCanceledException) means the client disconnected.
            // Return 499 Client Closed Request (nginx convention) — NOT a server error, so do not log at Error level.
            OperationCanceledException => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = "REQUEST_CANCELLED",
                Title = "Request Cancelled",
                Detail = "The request was cancelled by the client.",
                StatusCode = 499,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ElapsedMilliseconds = elapsedMs
            },

            ValidationException validationEx => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = validationEx.ErrorCode,
                Title = ErrorCategory.Validation.GetTitle(),
                Detail = BuildValidationDetail(validationEx),
                StatusCode = 400,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ValidationErrors = validationEx.Errors.ToDictionary(x => x.Key, x => x.Value),
                ElapsedMilliseconds = elapsedMs,
                InnerException = null
            },

            DomainException domainEx => domainEx.ToProblemDetailsContext(traceId, instance, userId, elapsedMs),

            UnauthorizedAccessException unauthorizedEx => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = ErrorCode.Authorization.Forbidden,
                Title = ErrorCategory.Unauthorized.GetTitle(),
                Detail = "Unauthorized access",
                StatusCode = 401,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ElapsedMilliseconds = elapsedMs
            },

            TimeoutException timeoutEx => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = ErrorCode.Infrastructure.TimeoutException,
                Title = ErrorCategory.ServiceUnavailable.GetTitle(),
                Detail = "Request timeout - operation took too long",
                StatusCode = 503,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ElapsedMilliseconds = elapsedMs,
                InnerException = timeoutEx
            },

            RpcException rpcEx => MapRpcExceptionToProblemContext(
                rpcEx,
                traceId,
                instance,
                userId,
                elapsedMs),

            HttpRequestException httpEx when httpEx.InnerException is TimeoutException => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = ErrorCode.Infrastructure.TimeoutException,
                Title = ErrorCategory.ServiceUnavailable.GetTitle(),
                Detail = "External service timeout",
                StatusCode = 503,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ElapsedMilliseconds = elapsedMs,
                InnerException = httpEx
            },

            HttpRequestException httpEx => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = ErrorCode.Infrastructure.ExternalServiceUnavailable,
                Title = ErrorCategory.ServiceUnavailable.GetTitle(),
                Detail = "External service unavailable",
                StatusCode = 503,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ElapsedMilliseconds = elapsedMs,
                InnerException = httpEx
            },

            Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException concurrencyEx => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = "CONCURRENCY_CONFLICT",
                Title = "Concurrency Conflict",
                Detail = "The record has been modified by another designer/user. Please refresh and try again.",
                StatusCode = 409,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ElapsedMilliseconds = elapsedMs,
                InnerException = concurrencyEx
            },

            _ => new DomainExceptions.ProblemDetailsContext
            {
                ErrorCode = ErrorCode.System.UnexpectedException,
                Title = ErrorCategory.Unexpected.GetTitle(),
                Detail = "An unexpected error occurred. Please contact support.",
                StatusCode = 500,
                Instance = instance,
                TraceId = traceId,
                UserId = userId,
                ElapsedMilliseconds = elapsedMs,
                InnerException = exception
            }
        };
    }

    private static string BuildValidationDetail(ValidationException exception)
    {
        if (exception.Errors.Count == 0)
        {
            return exception.Message;
        }

        var validationMessages = exception.Errors
            .SelectMany(error => error.Value.Select(message => $"{error.Key}: {message}"));

        return $"{exception.Message} {string.Join("; ", validationMessages)}";
    }

    private static DomainExceptions.ProblemDetailsContext MapRpcExceptionToProblemContext(
        RpcException exception,
        string traceId,
        string instance,
        string? userId,
        long elapsedMs)
    {
        var (statusCode, errorCode, title, detail) = exception.StatusCode switch
        {
            StatusCode.InvalidArgument => (
                StatusCodes.Status400BadRequest,
                ErrorCode.Validation.InvalidInput,
                ErrorCategory.Validation.GetTitle(),
                exception.Status.Detail),

            StatusCode.NotFound => (
                StatusCodes.Status404NotFound,
                ErrorCode.NotFound.ResourceNotFound,
                ErrorCategory.NotFound.GetTitle(),
                exception.Status.Detail),

            StatusCode.Unauthenticated => (
                StatusCodes.Status401Unauthorized,
                ErrorCode.Auth.InvalidToken,
                ErrorCategory.Unauthorized.GetTitle(),
                exception.Status.Detail),

            StatusCode.PermissionDenied => (
                StatusCodes.Status403Forbidden,
                ErrorCode.Authorization.Forbidden,
                ErrorCategory.Forbidden.GetTitle(),
                exception.Status.Detail),

            StatusCode.AlreadyExists => (
                StatusCodes.Status409Conflict,
                ErrorCode.Business.DuplicateEntity,
                ErrorCategory.Conflict.GetTitle(),
                exception.Status.Detail),

            StatusCode.Aborted => (
                StatusCodes.Status409Conflict,
                ErrorCode.Concurrency.ConflictOnUpdate,
                ErrorCategory.Conflict.GetTitle(),
                exception.Status.Detail),

            StatusCode.FailedPrecondition => (
                StatusCodes.Status409Conflict,
                ErrorCode.Business.BusinessRuleViolation,
                ErrorCategory.Conflict.GetTitle(),
                exception.Status.Detail),

            StatusCode.DeadlineExceeded => (
                StatusCodes.Status503ServiceUnavailable,
                ErrorCode.Infrastructure.TimeoutException,
                ErrorCategory.ServiceUnavailable.GetTitle(),
                exception.Status.Detail),

            StatusCode.Cancelled => (
                499,
                "REQUEST_CANCELLED",
                "Request Cancelled",
                exception.Status.Detail),

            StatusCode.Unavailable or StatusCode.ResourceExhausted => (
                StatusCodes.Status503ServiceUnavailable,
                ErrorCode.Infrastructure.ExternalServiceUnavailable,
                ErrorCategory.ServiceUnavailable.GetTitle(),
                exception.Status.Detail),

            _ => (
                StatusCodes.Status503ServiceUnavailable,
                ErrorCode.Infrastructure.ExternalServiceUnavailable,
                ErrorCategory.ServiceUnavailable.GetTitle(),
                "External gRPC service error")
        };

        return new DomainExceptions.ProblemDetailsContext
        {
            ErrorCode = errorCode,
            Title = title,
            Detail = string.IsNullOrWhiteSpace(detail) ? title : detail,
            StatusCode = statusCode,
            Instance = instance,
            TraceId = traceId,
            UserId = userId,
            ElapsedMilliseconds = elapsedMs,
            InnerException = exception
        };
    }

    private void LogException(Exception exception, DomainExceptions.ProblemDetailsContext context)
    {
        var logContext = new Dictionary<string, object>
        {
            ["ErrorCode"] = context.ErrorCode,
            ["StatusCode"] = context.StatusCode,
            ["TraceId"] = context.TraceId,
            ["ElapsedMs"] = context.ElapsedMilliseconds,
            ["Instance"] = context.Instance,
            ["ExceptionType"] = exception.GetType().FullName ?? exception.GetType().Name
        };

        if (context.UserId != null)
            logContext["UserId"] = context.UserId;

        if (context.ValidationErrors?.Any() == true)
            logContext["ValidationErrors"] = context.ValidationErrors;

        if (context.Extensions?.Any() == true)
            logContext["Details"] = context.Extensions;

        // Add stack trace for server errors
        if (context.StatusCode >= 500 && exception.StackTrace != null)
            logContext["StackTrace"] = exception.StackTrace;

        // Add inner exception details
        if (exception.InnerException != null)
        {
            logContext["InnerExceptionType"] = exception.InnerException.GetType().FullName ?? exception.InnerException.GetType().Name;
            logContext["InnerExceptionMessage"] = exception.InnerException.Message;
        }

        // Determine log level based on status code
        var logLevel = context.StatusCode switch
        {
            >= 500 => LogLevel.Error,
            >= 400 => LogLevel.Warning,
            _ => LogLevel.Information
        };

        using (_logger.BeginScope(logContext))
        {
            if (exception is DomainException)
            {
                _logger.Log(logLevel, exception, 
                    "❌ Domain Exception | ErrorCode: {ErrorCode} | Message: {Message} | CorrelationId: {CorrelationId}",
                    context.ErrorCode, exception.Message, context.TraceId);
            }
            else if (exception is ValidationException)
            {
                _logger.Log(logLevel, 
                    "⚠️ Validation Error | ErrorCode: {ErrorCode} | ValidationErrors: {@ValidationErrors} | CorrelationId: {CorrelationId}",
                    context.ErrorCode, context.ValidationErrors, context.TraceId);
            }
            else if (context.StatusCode >= 500)
            {
                _logger.LogError(exception, 
                    "🚨 System/Infrastructure Error | ErrorCode: {ErrorCode} | StatusCode: {StatusCode} | Instance: {Instance} | CorrelationId: {CorrelationId} | ExceptionType: {ExceptionType} | Message: {Message}",
                    context.ErrorCode, context.StatusCode, context.Instance, context.TraceId, exception.GetType().Name, exception.Message);
            }
            else
            {
                _logger.Log(logLevel, 
                    "❌ Exception | ErrorCode: {ErrorCode} | StatusCode: {StatusCode} | Message: {Message} | CorrelationId: {CorrelationId}",
                    context.ErrorCode, context.StatusCode, exception.Message, context.TraceId);
            }
        }
    }

    private static Task WriteProblemDetailsAsync(HttpContext context, DomainExceptions.ProblemDetailsContext problemContext)
    {
        context.Response.StatusCode = problemContext.StatusCode;

        var domainError = new Planora.BuildingBlocks.Domain.Error(
            problemContext.ErrorCode, 
            problemContext.Detail ?? problemContext.Title,
            MapStatusCodeToErrorType(problemContext.StatusCode));
        
        var response = Planora.BuildingBlocks.Domain.ApiResponse<object>.Failed(domainError, problemContext.TraceId);

        var options = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = false,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        return context.Response.WriteAsJsonAsync(response, options);
    }

    private static Planora.BuildingBlocks.Domain.ErrorType MapStatusCodeToErrorType(int statusCode) =>
        statusCode switch
        {
            StatusCodes.Status400BadRequest => Planora.BuildingBlocks.Domain.ErrorType.Validation,
            StatusCodes.Status401Unauthorized => Planora.BuildingBlocks.Domain.ErrorType.Unauthorized,
            StatusCodes.Status403Forbidden => Planora.BuildingBlocks.Domain.ErrorType.Forbidden,
            StatusCodes.Status404NotFound => Planora.BuildingBlocks.Domain.ErrorType.NotFound,
            StatusCodes.Status409Conflict => Planora.BuildingBlocks.Domain.ErrorType.Conflict,
            _ => Planora.BuildingBlocks.Domain.ErrorType.Failure
        };

    private static Task WriteUnsafeErrorAsync(HttpContext context, string traceId)
    {
        context.Response.StatusCode = 500;

        var domainError = new Planora.BuildingBlocks.Domain.Error("INTERNAL_SERVER_ERROR", "An unexpected error occurred", Planora.BuildingBlocks.Domain.ErrorType.Failure);
        var response = Planora.BuildingBlocks.Domain.ApiResponse<object>.Failed(domainError, traceId);

        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };

        return context.Response.WriteAsJsonAsync(response, options);
    }

    private static string GetProblemTypeUri(int statusCode) => statusCode switch
    {
        400 => "https://tools.ietf.org/html/rfc7231#section-6.5.1",
        401 => "https://tools.ietf.org/html/rfc7235#section-3.1",
        403 => "https://tools.ietf.org/html/rfc7231#section-6.5.3",
        404 => "https://tools.ietf.org/html/rfc7231#section-6.5.4",
        409 => "https://tools.ietf.org/html/rfc7231#section-6.5.8",
        503 => "https://tools.ietf.org/html/rfc7231#section-6.6.4",
        _ => "https://tools.ietf.org/html/rfc7231#section-6.6.1"
    };
}

public static class EnhancedGlobalExceptionHandlingExtensions
{
    public static IApplicationBuilder UseEnhancedGlobalExceptionHandling(this IApplicationBuilder app)
    {
        return app.UseMiddleware<EnhancedGlobalExceptionHandlerMiddleware>();
    }
}

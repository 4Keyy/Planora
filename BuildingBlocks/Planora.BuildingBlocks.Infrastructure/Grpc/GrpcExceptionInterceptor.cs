using Grpc.Core;
using Grpc.Core.Interceptors;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Validation;

namespace Planora.BuildingBlocks.Infrastructure.Grpc;

/// <summary>
/// gRPC interceptor that catches exceptions and maps them to appropriate gRPC StatusCodes.
/// Preserves error metadata for proper error handling across service boundaries.
/// </summary>
public sealed class GrpcExceptionInterceptor : Interceptor
{
    private readonly ILogger<GrpcExceptionInterceptor> _logger;

    public GrpcExceptionInterceptor(ILogger<GrpcExceptionInterceptor> logger)
    {
        _logger = logger;
    }

    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        try
        {
            return await continuation(request, context);
        }
        catch (Exception ex)
        {
            throw MapExceptionToRpcException(ex, context);
        }
    }

    public override async Task<TResponse> ClientStreamingServerHandler<TRequest, TResponse>(
        IAsyncStreamReader<TRequest> requestStream,
        ServerCallContext context,
        ClientStreamingServerMethod<TRequest, TResponse> continuation)
    {
        try
        {
            return await continuation(requestStream, context);
        }
        catch (Exception ex)
        {
            throw MapExceptionToRpcException(ex, context);
        }
    }

    public override async Task ServerStreamingServerHandler<TRequest, TResponse>(
        TRequest request,
        IServerStreamWriter<TResponse> responseStream,
        ServerCallContext context,
        ServerStreamingServerMethod<TRequest, TResponse> continuation)
    {
        try
        {
            await continuation(request, responseStream, context);
        }
        catch (Exception ex)
        {
            throw MapExceptionToRpcException(ex, context);
        }
    }

    public override async Task DuplexStreamingServerHandler<TRequest, TResponse>(
        IAsyncStreamReader<TRequest> requestStream,
        IServerStreamWriter<TResponse> responseStream,
        ServerCallContext context,
        DuplexStreamingServerMethod<TRequest, TResponse> continuation)
    {
        try
        {
            await continuation(requestStream, responseStream, context);
        }
        catch (Exception ex)
        {
            throw MapExceptionToRpcException(ex, context);
        }
    }

    private RpcException MapExceptionToRpcException(Exception exception, ServerCallContext context)
    {
        var (statusCode, errorCode, message) = exception switch
        {
            ValidationException validationEx => (
                StatusCode.InvalidArgument,
                validationEx.ErrorCode,
                validationEx.Message
            ),

            EntityNotFoundException notFoundEx => (
                StatusCode.NotFound,
                ErrorCode.NotFound.ResourceNotFound,
                notFoundEx.Message
            ),

            DuplicateEntityException duplicateEx => (
                StatusCode.AlreadyExists,
                ErrorCode.Business.DuplicateEntity,
                duplicateEx.Message
            ),

            ConcurrencyException concurrencyEx => (
                StatusCode.Aborted,
                ErrorCode.Concurrency.ConflictOnUpdate,
                concurrencyEx.Message
            ),

            ForbiddenException forbiddenEx => (
                StatusCode.PermissionDenied,
                ErrorCode.Authorization.Forbidden,
                forbiddenEx.Message
            ),

            UnauthorizedAccessException unauthorizedEx => (
                StatusCode.Unauthenticated,
                ErrorCode.Auth.InvalidCredentials,
                unauthorizedEx.Message
            ),

            BusinessRuleViolationException businessEx => (
                StatusCode.FailedPrecondition,
                ErrorCode.Business.BusinessRuleViolation,
                businessEx.Message
            ),

            InvalidValueObjectException invalidEx => (
                StatusCode.InvalidArgument,
                ErrorCode.Validation.InvalidFormat,
                invalidEx.Message
            ),

            TimeoutException timeoutEx => (
                StatusCode.DeadlineExceeded,
                ErrorCode.Infrastructure.TimeoutException,
                "Request timeout"
            ),

            _ => (
                StatusCode.Internal,
                ErrorCode.System.UnexpectedException,
                "An internal error occurred"
            )
        };

        // Log the exception with context
        _logger.LogError(
            exception,
            "gRPC Exception | Method: {Method} | StatusCode: {StatusCode} | ErrorCode: {ErrorCode} | CorrelationId: {CorrelationId}",
            context.Method,
            statusCode,
            errorCode,
            context.RequestHeaders.GetValue("x-correlation-id") ?? "unknown");

        // Create metadata with error details
        var metadata = new Metadata
        {
            { "error-code", errorCode },
            { "correlation-id", context.RequestHeaders.GetValue("x-correlation-id") ?? Guid.NewGuid().ToString() }
        };

        // Add validation errors if present
        if (exception is ValidationException validationException)
        {
            var validationErrors = string.Join("; ", 
                validationException.Errors.SelectMany(e => 
                    e.Value.Select(v => $"{e.Key}: {v}")));
            metadata.Add("validation-errors", validationErrors);
        }

        return new RpcException(new Status(statusCode, message), metadata);
    }
}

/// <summary>
/// Extension methods for gRPC error handling.
/// </summary>
public static class GrpcInterceptorExtensions
{
    /// <summary>
    /// Adds gRPC exception interceptor to the service collection.
    /// </summary>
    public static IServiceCollection AddGrpcExceptionInterceptor(this IServiceCollection services)
    {
        services.AddSingleton<GrpcExceptionInterceptor>();
        return services;
    }

    /// <summary>
    /// Gets header value from metadata.
    /// </summary>
    private static string? GetValue(this Metadata headers, string key)
    {
        return headers.FirstOrDefault(h => h.Key.Equals(key, StringComparison.OrdinalIgnoreCase))?.Value;
    }
}

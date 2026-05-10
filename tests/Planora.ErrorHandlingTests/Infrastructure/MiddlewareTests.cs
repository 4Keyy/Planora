using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Application.Validation;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using Grpc.Core;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using Xunit;
using FluentAssertions;
using Moq;

namespace Planora.ErrorHandlingTests.Infrastructure.Middleware;

public class EnhancedGlobalExceptionHandlerMiddlewareTests
{
    private readonly IServiceProvider _serviceProvider;

    public EnhancedGlobalExceptionHandlerMiddlewareTests()
    {
        var services = new ServiceCollection();
        services.AddLogging(config => config.AddConsole());
        _serviceProvider = services.BuildServiceProvider();
    }

    [Fact]
    public async Task CsrfMiddleware_ShouldRejectStateChangingAuthRequestWithoutMatchingHeader()
    {
        var nextCalled = false;
        var middleware = new CsrfProtectionMiddleware(
            _ =>
            {
                nextCalled = true;
                return Task.CompletedTask;
            },
            _serviceProvider.GetRequiredService<ILogger<CsrfProtectionMiddleware>>());
        var httpContext = CreateHttpContext();
        httpContext.Request.Path = "/api/v1/auth/refresh";
        httpContext.Request.Method = "POST";
        httpContext.Request.Headers.Cookie = "XSRF-TOKEN=csrf-token";

        await middleware.InvokeAsync(httpContext);

        nextCalled.Should().BeFalse();
        httpContext.Response.StatusCode.Should().Be(StatusCodes.Status403Forbidden);
        httpContext.Response.Body.Seek(0, SeekOrigin.Begin);
        var responseBody = await new StreamReader(httpContext.Response.Body).ReadToEndAsync();
        responseBody.Should().Contain("CSRF_VALIDATION_FAILED");
    }

    [Fact]
    public async Task CsrfMiddleware_ShouldAllowStateChangingAuthRequestWithMatchingCookieAndHeader()
    {
        var nextCalled = false;
        var middleware = new CsrfProtectionMiddleware(
            context =>
            {
                nextCalled = true;
                context.Response.StatusCode = StatusCodes.Status204NoContent;
                return Task.CompletedTask;
            },
            _serviceProvider.GetRequiredService<ILogger<CsrfProtectionMiddleware>>());
        var httpContext = CreateHttpContext();
        httpContext.Request.Path = "/api/v1/auth/refresh";
        httpContext.Request.Method = "POST";
        httpContext.Request.Headers.Cookie = "XSRF-TOKEN=csrf-token";
        httpContext.Request.Headers["X-CSRF-Token"] = "csrf-token";

        await middleware.InvokeAsync(httpContext);

        nextCalled.Should().BeTrue();
        httpContext.Response.StatusCode.Should().Be(StatusCodes.Status204NoContent);
    }

    private EnhancedGlobalExceptionHandlerMiddleware CreateMiddleware(
        ILogger<EnhancedGlobalExceptionHandlerMiddleware>? logger = null)
    {
        logger ??= _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>();

        RequestDelegate next = async context =>
        {
            await Task.CompletedTask;
        };

        return new EnhancedGlobalExceptionHandlerMiddleware(next, logger);
    }

    [Fact]
    public async Task Middleware_ShouldHandleDomainException()
    {
        var middleware = CreateMiddleware();
        var httpContext = CreateHttpContext();

        var exception = new EntityNotFoundException("User", Guid.NewGuid());

        RequestDelegate next = context =>
            throw exception;

        var middlewareWithException = new EnhancedGlobalExceptionHandlerMiddleware(next, 
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middlewareWithException.InvokeAsync(httpContext);

        httpContext.Response.StatusCode.Should().Be(404);
        httpContext.Response.ContentType.Should().Be("application/json; charset=utf-8");
    }

    [Fact]
    public async Task Middleware_ShouldHandleValidationException()
    {
        var errors = new Dictionary<string, string[]>
        {
            { "email", new[] { "Invalid format" } }
        };

        var exception = new ValidationException("Validation failed", errors);

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.StatusCode.Should().Be(400);
        httpContext.Response.ContentType.Should().Be("application/json; charset=utf-8");
    }

    [Fact]
    public async Task Middleware_ShouldHandleUnauthorizedAccessException()
    {
        var exception = new UnauthorizedAccessException("Access denied");

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task Middleware_ShouldHandleTimeoutException()
    {
        var exception = new TimeoutException("Request timeout");

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.StatusCode.Should().Be(503);
    }

    [Theory]
    [InlineData(StatusCode.InvalidArgument, 400, "VALIDATION.INVALID_INPUT")]
    [InlineData(StatusCode.NotFound, 404, "NOT_FOUND.RESOURCE")]
    [InlineData(StatusCode.Unauthenticated, 401, "AUTH.INVALID_TOKEN")]
    [InlineData(StatusCode.PermissionDenied, 403, "AUTHORIZATION.FORBIDDEN")]
    [InlineData(StatusCode.AlreadyExists, 409, "BUSINESS.DUPLICATE_ENTITY")]
    [InlineData(StatusCode.Aborted, 409, "CONCURRENCY.CONFLICT_ON_UPDATE")]
    [InlineData(StatusCode.FailedPrecondition, 409, "BUSINESS.RULE_VIOLATION")]
    [InlineData(StatusCode.DeadlineExceeded, 503, "INFRASTRUCTURE.TIMEOUT")]
    [InlineData(StatusCode.Cancelled, 499, "REQUEST_CANCELLED")]
    [InlineData(StatusCode.Unavailable, 503, "INFRASTRUCTURE.EXTERNAL_SERVICE_UNAVAILABLE")]
    [InlineData(StatusCode.Unknown, 503, "INFRASTRUCTURE.EXTERNAL_SERVICE_UNAVAILABLE")]
    public async Task Middleware_ShouldMapGrpcRpcExceptions(
        StatusCode grpcStatus,
        int expectedHttpStatus,
        string expectedErrorCode)
    {
        var exception = new RpcException(new Status(grpcStatus, "downstream failure"));

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.StatusCode.Should().Be(expectedHttpStatus);
        httpContext.Response.Body.Seek(0, SeekOrigin.Begin);
        using var document = await JsonDocument.ParseAsync(httpContext.Response.Body);
        document.RootElement.GetProperty("error").GetProperty("code").GetString()
            .Should().Be(expectedErrorCode);
    }

    [Fact]
    public async Task Middleware_ShouldHandleGenericException()
    {
        var exception = new InvalidOperationException("Unexpected error");

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.StatusCode.Should().Be(500);
    }

    [Fact]
    public async Task Middleware_ShouldNotExposeStackTraceToClient()
    {
        var exception = new InvalidOperationException("This should not be exposed");

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.Body.Seek(0, SeekOrigin.Begin);
        var reader = new StreamReader(httpContext.Response.Body);
        var responseBody = await reader.ReadToEndAsync();

        responseBody.Should().NotContain("InvalidOperationException");
        responseBody.Should().NotContain("stack trace");
        responseBody.Should().NotContain("This should not be exposed");
    }

    [Fact]
    public async Task Middleware_ShouldIncludeCorrelationIdInResponse()
    {
        var exception = new EntityNotFoundException("Item", Guid.NewGuid());

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.Body.Seek(0, SeekOrigin.Begin);
        var reader = new StreamReader(httpContext.Response.Body);
        var responseBody = await reader.ReadToEndAsync();

        responseBody.Should().Contain("correlationId");
    }

    [Fact]
    public async Task Middleware_ShouldIncludeErrorCodeInResponse()
    {
        var exception = new EntityNotFoundException("User", Guid.NewGuid());

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.Body.Seek(0, SeekOrigin.Begin);
        var reader = new StreamReader(httpContext.Response.Body);
        var responseBody = await reader.ReadToEndAsync();

        responseBody.Should().Contain("code");
        responseBody.Should().Contain(ErrorCode.NotFound.ResourceNotFound);
    }

    [Fact]
    public async Task Middleware_ShouldSerializeMappedDomainErrorType()
    {
        var exception = new EntityNotFoundException("User", Guid.NewGuid());

        RequestDelegate next = context =>
            throw exception;

        var httpContext = CreateHttpContext();
        var middleware = new EnhancedGlobalExceptionHandlerMiddleware(next,
            _serviceProvider.GetRequiredService<ILogger<EnhancedGlobalExceptionHandlerMiddleware>>());

        await middleware.InvokeAsync(httpContext);

        httpContext.Response.Body.Seek(0, SeekOrigin.Begin);
        using var document = await JsonDocument.ParseAsync(httpContext.Response.Body);

        var errorType = document.RootElement
            .GetProperty("error")
            .GetProperty("type")
            .GetInt32();

        errorType.Should().Be((int)ErrorType.NotFound);
    }

    private DefaultHttpContext CreateHttpContext()
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Path = "/api/test";
        httpContext.Request.Method = "GET";
        httpContext.Response.Body = new MemoryStream();
        httpContext.TraceIdentifier = Guid.NewGuid().ToString();
        return httpContext;
    }
}

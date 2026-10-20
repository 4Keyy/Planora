using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Logging;
using Planora.Auth.Api.Controllers;
using Planora.Auth.Application.Features.ClientErrors;

namespace Planora.UnitTests.Services.AuthApi.Controllers;

/// <summary>
/// The web client's failures reach the logs (FE-16): bounded, single-line, anonymous and
/// rate-limited, because anyone may send them.
/// </summary>
public sealed class ClientErrorsControllerTests
{
    private static ClientErrorReport Valid() => new()
    {
        Kind = "unhandledrejection",
        Name = "TypeError",
        Message = "Cannot read properties of undefined (reading 'title')",
        Stack = "TypeError: Cannot read properties of undefined\n    at TodoCard (app.js:1:2)",
        Digest = "1742815393",
        Route = "/dashboard",
        OccurredAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task Report_LogsAWarningAndAccepts()
    {
        var logger = new RecordingLogger();
        var controller = new ClientErrorsController(new ClientErrorReportValidator(), logger);

        var result = await controller.Report(Valid(), CancellationToken.None);

        Assert.IsType<AcceptedResult>(result);
        var entry = Assert.Single(logger.Entries);
        Assert.Equal(LogLevel.Warning, entry.Level);
        Assert.Equal("Client unhandledrejection TypeError on /dashboard: Cannot read properties of undefined (reading 'title')", entry.Message);
        Assert.Equal("1742815393", entry.Scope["ClientErrorDigest"]);
        Assert.Equal("TypeError: Cannot read properties of undefined |     at TodoCard (app.js:1:2)", entry.Scope["ClientStack"]);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task Report_KeepsEveryReportOnOneLogLine()
    {
        var logger = new RecordingLogger();
        var controller = new ClientErrorsController(new ClientErrorReportValidator(), logger);

        await controller.Report(Valid() with { Message = "boom\r\n[ERR] forged entry\u001b[31m" }, CancellationToken.None);

        var entry = Assert.Single(logger.Entries);
        Assert.DoesNotContain('\n', entry.Message);
        Assert.DoesNotContain('\r', entry.Message);
        Assert.DoesNotContain('\u001b', entry.Message);
        Assert.EndsWith("boom  [ERR] forged entry [31m", entry.Message);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task Report_RejectsAnInvalidReport_WithoutLogging()
    {
        var logger = new RecordingLogger();
        var controller = new ClientErrorsController(new ClientErrorReportValidator(), logger);

        var result = await controller.Report(Valid() with { Kind = "anything" }, CancellationToken.None);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Empty(logger.Entries);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void Endpoint_IsAnonymousAndRateLimited()
    {
        var type = typeof(ClientErrorsController);

        Assert.NotNull(type.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Equal("client-errors", type.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
        Assert.Equal("api/v1/client-errors", type.GetCustomAttribute<RouteAttribute>()?.Template);
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [InlineData("route", "/dashboard?token=abc")]
    [InlineData("route", "/tasks#top")]
    [InlineData("route", "dashboard")]
    [InlineData("digest", "abc def")]
    [InlineData("message", "")]
    [InlineData("kind", "warning")]
    public void Validator_RejectsReportsOutsideTheirBounds(string field, string value)
    {
        var report = field switch
        {
            "route" => Valid() with { Route = value },
            "digest" => Valid() with { Digest = value },
            "message" => Valid() with { Message = value },
            _ => Valid() with { Kind = value },
        };

        Assert.False(new ClientErrorReportValidator().Validate(report).IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public void Validator_BoundsTheTextAnAnonymousCallerCanLog()
    {
        var validator = new ClientErrorReportValidator();

        Assert.True(validator.Validate(Valid()).IsValid);
        Assert.True(validator.Validate(Valid() with { Name = null, Stack = null, Digest = null, OccurredAt = null }).IsValid);
        Assert.False(validator.Validate(Valid() with { Message = new string('x', ClientErrorReportValidator.MaxMessageLength + 1) }).IsValid);
        Assert.False(validator.Validate(Valid() with { Stack = new string('x', ClientErrorReportValidator.MaxStackLength + 1) }).IsValid);
    }

    private sealed class RecordingLogger : ILogger<ClientErrorsController>
    {
        private readonly Stack<IReadOnlyDictionary<string, object?>> _scopes = new();

        public List<(LogLevel Level, string Message, IReadOnlyDictionary<string, object?> Scope)> Entries { get; } = [];

        public IDisposable BeginScope<TState>(TState state) where TState : notnull
        {
            _scopes.Push(state as IReadOnlyDictionary<string, object?> ?? new Dictionary<string, object?>());
            return new PopScope(_scopes);
        }

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            Entries.Add((logLevel, formatter(state, exception), _scopes.Count > 0 ? _scopes.Peek() : new Dictionary<string, object?>()));

        private sealed class PopScope(Stack<IReadOnlyDictionary<string, object?>> scopes) : IDisposable
        {
            public void Dispose() => scopes.Pop();
        }
    }
}

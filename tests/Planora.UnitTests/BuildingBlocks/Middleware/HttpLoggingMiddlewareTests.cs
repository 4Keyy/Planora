using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Logging;

namespace Planora.UnitTests.BuildingBlocks.Middleware;

public sealed class HttpLoggingMiddlewareTests
{
    [Fact]
    public async Task StreamingResponse_ReachesTheOriginalBodyBeforeTheHandlerReturns()
    {
        using var body = new MemoryStream();
        var context = new DefaultHttpContext();
        context.Response.Body = body;
        var logger = new CapturingLogger();
        var middleware = new HttpLoggingMiddleware(async current =>
        {
            current.Response.ContentType = "text/event-stream";
            await current.Response.WriteAsync("data: first\n\n");
            await current.Response.Body.FlushAsync();
            Assert.NotEmpty(body.ToArray());
        }, logger);

        await middleware.InvokeAsync(context);

        Assert.Same(body, context.Response.Body);
        Assert.Null(logger.Entries[1]["ResponseSize"]);
    }

    [Fact]
    public async Task FailedHandler_LeavesTheOriginalBodyInPlaceForTheOuterPipeline()
    {
        using var body = new MemoryStream();
        var context = new DefaultHttpContext();
        context.Response.Body = body;
        var logger = new CapturingLogger();
        var failure = new InvalidOperationException("Synthetic handler failure");
        var middleware = new HttpLoggingMiddleware(_ => Task.FromException(failure), logger);

        Assert.Same(failure, await Assert.ThrowsAsync<InvalidOperationException>(() => middleware.InvokeAsync(context)));
        Assert.Same(body, context.Response.Body);
        Assert.Same(failure, logger.LastException);
    }

    [Theory]
    [InlineData("sub")]
    [InlineData(ClaimTypes.NameIdentifier)]
    public async Task HttpLogs_CorrelateRawAndMappedSubjectClaims(string subjectClaim)
    {
        using var body = new MemoryStream();
        var userId = Guid.NewGuid().ToString();
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(subjectClaim, userId)], "Test"))
        };
        context.Response.Body = body;
        var logger = new CapturingLogger();
        var middleware = new HttpLoggingMiddleware(current =>
        {
            current.Response.ContentLength = 12;
            return Task.CompletedTask;
        }, logger);

        await middleware.InvokeAsync(context);

        Assert.Equal(2, logger.Entries.Count);
        Assert.All(logger.Entries, entry => Assert.Equal(userId, entry["UserId"]));
        Assert.Equal(12L, logger.Entries[1]["ResponseSize"]);
    }

    private sealed class CapturingLogger : ILogger<HttpLoggingMiddleware>
    {
        public List<Dictionary<string, object?>> Entries { get; } = [];
        public Exception? LastException { get; private set; }

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (state is IEnumerable<KeyValuePair<string, object?>> values)
                Entries.Add(values.ToDictionary());
            LastException = exception;
        }
    }
}

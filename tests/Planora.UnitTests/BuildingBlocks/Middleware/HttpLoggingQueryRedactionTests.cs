using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Logging;

namespace Planora.UnitTests.BuildingBlocks.Middleware;

public sealed class HttpLoggingQueryRedactionTests
{
    private const string SyntheticValue = "synthetic-query-value";

    [Theory]
    [InlineData("%74oken", "token")]
    [InlineData("access%5Ftoken", "access_token")]
    [InlineData("%41CCESS_TOKEN", "access_token")]
    [InlineData("refresh%5ftoken", "refresh_token")]
    [InlineData("api%5fkey", "api_key")]
    public async Task EncodedSensitiveKeys_AreRedactedInBothHttpLogPaths(string encodedKey, string readerKey)
    {
        var context = Context($"?{encodedKey}={SyntheticValue}");
        Assert.Equal(SyntheticValue, context.Request.Query[readerKey].ToString());

        var paths = await InvokeAsync(context);

        Assert.Equal(2, paths.Count);
        Assert.All(paths, path =>
        {
            Assert.DoesNotContain(SyntheticValue, path);
            Assert.Contains($"{encodedKey}=***REDACTED***", path);
        });
    }

    [Fact]
    public async Task GrpcRequest_UsesTheSameDecodedKeyRedaction()
    {
        var context = Context($"?access%5ftoken={SyntheticValue}");
        context.Request.ContentType = "application/grpc+proto";

        var paths = await InvokeAsync(context);

        Assert.Equal(2, paths.Count);
        Assert.Contains("access%5ftoken=***REDACTED***", paths[0]);
        Assert.All(paths, path => Assert.DoesNotContain(SyntheticValue, path));
    }

    [Fact]
    public async Task RepeatedEncodedAndPlainKeys_EachRedactTheirOwnValue()
    {
        var paths = await InvokeAsync(Context($"?%74oken={SyntheticValue}&TOKEN=second-synthetic&token="));

        Assert.All(paths, path => Assert.Equal(
            "/auth/verify?%74oken=***REDACTED***&TOKEN=***REDACTED***&token=***REDACTED***", path));
    }

    [Theory]
    [InlineData("?q=a%2Bb+c&%71=plain&broken%=visible&%ZZ=value")]
    [InlineData("?q=value%0D%0Atext&empty=&flag")]
    public async Task OrdinaryAndMalformedKeys_PreserveRawQueryWithoutThrowing(string query)
    {
        var paths = await InvokeAsync(Context(query));
        var expected = "/auth/verify" + (query.EndsWith("&flag", StringComparison.Ordinal) ? query + "=" : query);
        Assert.All(paths, path => Assert.Equal(expected, path));
    }

    private static DefaultHttpContext Context(string query)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = "GET";
        context.Request.Path = "/auth/verify";
        context.Request.QueryString = new QueryString(query);
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static async Task<List<string>> InvokeAsync(DefaultHttpContext context)
    {
        var logger = new PathLogger();
        // Keep ownership of the original stream; response-stream lifecycle is a separate audit gate.
        using var originalBody = context.Response.Body;
        var middleware = new HttpLoggingMiddleware(_ => Task.CompletedTask, logger);
        await middleware.InvokeAsync(context);
        return logger.Paths;
    }

    private sealed class PathLogger : ILogger<HttpLoggingMiddleware>
    {
        public List<string> Paths { get; } = [];
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            if (state is IEnumerable<KeyValuePair<string, object?>> properties)
                Paths.AddRange(properties.Where(property => property.Key == "Path")
                    .Select(property => property.Value?.ToString() ?? string.Empty));
        }
    }
}

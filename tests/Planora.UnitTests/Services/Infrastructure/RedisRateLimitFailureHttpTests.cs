using System.Net;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using StackExchange.Redis;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class RedisRateLimitFailureHttpTests
{
    [Theory]
    [InlineData("connection", false, HttpStatusCode.ServiceUnavailable, "INFRASTRUCTURE.EXTERNAL_SERVICE_UNAVAILABLE")]
    [InlineData("connection", true, HttpStatusCode.ServiceUnavailable, "INFRASTRUCTURE.EXTERNAL_SERVICE_UNAVAILABLE")]
    [InlineData("timeout", false, HttpStatusCode.ServiceUnavailable, "INFRASTRUCTURE.TIMEOUT")]
    [InlineData("timeout", true, HttpStatusCode.ServiceUnavailable, "INFRASTRUCTURE.TIMEOUT")]
    [InlineData("server", false, HttpStatusCode.InternalServerError, "SYSTEM.UNEXPECTED_EXCEPTION")]
    [InlineData("command", false, HttpStatusCode.InternalServerError, "SYSTEM.UNEXPECTED_EXCEPTION")]
    public async Task RedisLimiterFailure_IsFailClosedWithTypedHttpStatus_AfterAuthenticationFailure(
        string failure, bool allowAnonymous, HttpStatusCode expectedStatus, string expectedCode)
    {
        const string sensitiveDiagnostic = "synthetic-private-redis-host:6379 synthetic-private-diagnostic";
        Exception error = failure switch
        {
            "connection" => new RedisConnectionException(ConnectionFailureType.SocketFailure, sensitiveDiagnostic),
            "timeout" => new RedisTimeoutException(sensitiveDiagnostic, CommandStatus.Sent),
            "server" => new RedisServerException(sensitiveDiagnostic),
            "command" => new RedisCommandException(sensitiveDiagnostic),
            _ => throw new ArgumentOutOfRangeException(nameof(failure))
        };
        var database = new Mock<IDatabase>();
        database.Setup(db => db.ScriptEvaluateAsync(It.IsAny<string>(), It.IsAny<RedisKey[]>(),
                It.IsAny<RedisValue[]>(), It.IsAny<CommandFlags>())).ThrowsAsync(error);
        database.Setup(db => db.ScriptEvaluateAsync(It.IsAny<byte[]>(), It.IsAny<RedisKey[]>(),
                It.IsAny<RedisValue[]>(), It.IsAny<CommandFlags>())).ThrowsAsync(error);
        database.Setup(db => db.ScriptEvaluateAsync(It.IsAny<LuaScript>(), It.IsAny<object>(),
                It.IsAny<CommandFlags>())).ThrowsAsync(error);
        database.Setup(db => db.ScriptEvaluateAsync(It.IsAny<LoadedLuaScript>(), It.IsAny<object>(),
                It.IsAny<CommandFlags>())).ThrowsAsync(error);
        var redis = new Mock<IConnectionMultiplexer>();
        redis.SetupGet(connection => connection.IsConnected).Returns(true);
        redis.Setup(connection => connection.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(database.Object);

        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.Configuration.Sources.Clear();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["RateLimiting:Backend"] = "Redis",
            ["RateLimiting:Scope"] = "synthetic-outage-http"
        });
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Services.AddSingleton(redis.Object);
        builder.Services.AddConfiguredRateLimiting(builder.Configuration);
        builder.Services.AddAuthentication("SyntheticBearer")
            .AddScheme<AuthenticationSchemeOptions, RejectedAuthenticationHandler>("SyntheticBearer", _ => { });
        builder.Services.AddAuthorization();

        await using var app = builder.Build();
        app.UseRouting();
        app.UseEnhancedGlobalExceptionHandling();
        app.UseAuthentication();
        app.UseRateLimiter();
        app.UseAuthorization();
        var endpointCalls = 0;
        var endpoint = app.MapGet("/synthetic-resource", () =>
        {
            Interlocked.Increment(ref endpointCalls);
            return Results.Ok(new { data = "must never be returned during limiter failure" });
        });
        if (allowAnonymous)
            endpoint.AllowAnonymous();
        else
            endpoint.RequireAuthorization();

        await app.StartAsync();
        try
        {
            var addresses = app.Services.GetRequiredService<Microsoft.AspNetCore.Hosting.Server.IServer>()
                .Features.Get<IServerAddressesFeature>()!;
            using var client = new HttpClient
            {
                BaseAddress = new Uri(Assert.Single(addresses.Addresses)), Timeout = TimeSpan.FromSeconds(10)
            };
            var response = await client.GetAsync("/synthetic-resource");
            var body = await response.Content.ReadAsStringAsync();

            Assert.Contains(database.Invocations, invocation => invocation.Method.Name == nameof(IDatabase.ScriptEvaluateAsync));
            Assert.Equal(expectedStatus, response.StatusCode);
            Assert.Equal(0, endpointCalls);
            using var json = JsonDocument.Parse(body);
            Assert.False(json.RootElement.GetProperty("success").GetBoolean());
            Assert.Equal(expectedCode, json.RootElement.GetProperty("error").GetProperty("code").GetString());
            Assert.DoesNotContain(sensitiveDiagnostic, body);
            Assert.DoesNotContain("StackExchange.Redis", body);
            Assert.DoesNotContain("must never be returned", body);
        }
        finally
        {
            await app.StopAsync();
        }
    }

    private sealed class RejectedAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
            Task.FromResult(AuthenticateResult.Fail("Synthetic security-stamp lookup failure"));
    }
}

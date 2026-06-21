using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Moq;
using Planora.BuildingBlocks.Infrastructure.Middleware;
using StackExchange.Redis;

namespace Planora.UnitTests.BuildingBlocks.Middleware;

public class IdempotencyMiddlewareTests
{
    private const string Header = "X-Idempotency-Key";

    [Fact]
    public async Task NonMutatingMethod_BypassesIdempotency()
    {
        var db = BuildDb(reserved: true, existing: RedisValue.Null);
        var called = false;
        var middleware = Build(db, _ => { called = true; return Task.CompletedTask; });

        var ctx = NewContext("GET", key: "k1");
        await middleware.InvokeAsync(ctx);

        Assert.True(called);
        db.Verify(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
            It.IsAny<TimeSpan?>(), It.IsAny<When>()), Times.Never);
    }

    [Fact]
    public async Task MissingHeader_BypassesIdempotency()
    {
        var db = BuildDb(reserved: true, existing: RedisValue.Null);
        var called = false;
        var middleware = Build(db, _ => { called = true; return Task.CompletedTask; });

        var ctx = NewContext("POST", key: null);
        await middleware.InvokeAsync(ctx);

        Assert.True(called);
        db.Verify(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
            It.IsAny<TimeSpan?>(), It.IsAny<When>()), Times.Never);
    }

    [Fact]
    public async Task FirstRequest_ReservesExecutesAndCachesSuccess()
    {
        var db = BuildDb(reserved: true, existing: RedisValue.Null);
        var middleware = Build(db, async ctx =>
        {
            ctx.Response.StatusCode = 201;
            await ctx.Response.WriteAsync("created");
        });

        var ctx = NewContext("POST", key: "k1");
        var original = new MemoryStream();
        ctx.Response.Body = original;

        await middleware.InvokeAsync(ctx);

        Assert.Equal(201, ctx.Response.StatusCode);
        Assert.Equal("created", Encoding.UTF8.GetString(original.ToArray()));
        // Reservation (NX) + a completed-response cache write.
        db.Verify(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
            It.IsAny<TimeSpan?>(), When.NotExists), Times.Once);
        db.Verify(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
            It.IsAny<TimeSpan?>(), When.Always), Times.Once);
        db.Verify(d => d.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()), Times.Never);
    }

    [Fact]
    public async Task ConcurrentInFlight_Returns409AndDoesNotExecute()
    {
        // Reservation fails and the stored value is still the pending marker.
        var db = BuildDb(reserved: false, existing: "pending");
        var called = false;
        var middleware = Build(db, _ => { called = true; return Task.CompletedTask; });

        var ctx = NewContext("POST", key: "k1");
        ctx.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(ctx);

        Assert.False(called);
        Assert.Equal(StatusCodes.Status409Conflict, ctx.Response.StatusCode);
    }

    [Fact]
    public async Task CompletedKey_ReplaysCachedResponseWithoutExecuting()
    {
        var cached = JsonSerializer.Serialize(new { StatusCode = 200, Body = "cached-body" });
        var db = BuildDb(reserved: false, existing: cached);
        var called = false;
        var middleware = Build(db, _ => { called = true; return Task.CompletedTask; });

        var ctx = NewContext("POST", key: "k1");
        var original = new MemoryStream();
        ctx.Response.Body = original;

        await middleware.InvokeAsync(ctx);

        Assert.False(called);
        Assert.Equal(200, ctx.Response.StatusCode);
        Assert.Equal("cached-body", Encoding.UTF8.GetString(original.ToArray()));
    }

    [Fact]
    public async Task NonSuccessStatus_ReleasesReservationAndIsNotCached()
    {
        var db = BuildDb(reserved: true, existing: RedisValue.Null);
        var middleware = Build(db, async ctx =>
        {
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsync("bad");
        });

        var ctx = NewContext("POST", key: "k1");
        ctx.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(ctx);

        db.Verify(d => d.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()), Times.Once);
        // Only the reservation write happened; no completed-response cache write.
        db.Verify(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
            It.IsAny<TimeSpan?>(), When.Always), Times.Never);
    }

    [Fact]
    public async Task PipelineThrows_RestoresStreamReleasesReservationAndRethrows()
    {
        var db = BuildDb(reserved: true, existing: RedisValue.Null);
        var middleware = Build(db, _ => throw new InvalidOperationException("boom"));

        var ctx = NewContext("POST", key: "k1");
        var original = new MemoryStream();
        ctx.Response.Body = original;

        await Assert.ThrowsAsync<InvalidOperationException>(() => middleware.InvokeAsync(ctx));

        // The captured MemoryStream must have been swapped back so error handling can write.
        Assert.Same(original, ctx.Response.Body);
        db.Verify(d => d.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()), Times.Once);
    }

    [Fact]
    public async Task ReservationThrows_FailsOpenAndExecutes()
    {
        var db = new Mock<IDatabase>();
        db.Setup(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
                It.IsAny<TimeSpan?>(), When.NotExists))
            .ThrowsAsync(new RedisConnectionException(ConnectionFailureType.UnableToConnect, "down"));
        var called = false;
        var middleware = Build(db, _ => { called = true; return Task.CompletedTask; });

        var ctx = NewContext("POST", key: "k1");
        ctx.Response.Body = new MemoryStream();

        await middleware.InvokeAsync(ctx);

        Assert.True(called);
    }

    private static IdempotencyMiddleware Build(Mock<IDatabase> db, RequestDelegate next)
    {
        var redis = new Mock<IConnectionMultiplexer>();
        redis.Setup(r => r.GetDatabase(It.IsAny<int>(), It.IsAny<object>())).Returns(db.Object);
        return new IdempotencyMiddleware(next, redis.Object, Mock.Of<ILogger<IdempotencyMiddleware>>());
    }

    private static Mock<IDatabase> BuildDb(bool reserved, RedisValue existing)
    {
        var db = new Mock<IDatabase>();
        // Generic StringSet (e.g. the completed-response write) succeeds.
        db.Setup(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
                It.IsAny<TimeSpan?>(), It.IsAny<When>()))
            .ReturnsAsync(true);
        // The NX reservation result is controlled per-test (configured last → wins).
        db.Setup(d => d.StringSetAsync(It.IsAny<RedisKey>(), It.IsAny<RedisValue>(),
                It.IsAny<TimeSpan?>(), When.NotExists))
            .ReturnsAsync(reserved);
        db.Setup(d => d.StringGetAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .ReturnsAsync(existing);
        db.Setup(d => d.KeyDeleteAsync(It.IsAny<RedisKey>(), It.IsAny<CommandFlags>()))
            .ReturnsAsync(true);
        return db;
    }

    private static DefaultHttpContext NewContext(string method, string? key)
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Method = method;
        if (key is not null)
        {
            ctx.Request.Headers[Header] = key;
        }
        return ctx;
    }
}

using System.Security.Claims;
using StackExchange.Redis;

namespace Planora.BuildingBlocks.Infrastructure.Middleware;

/// <summary>
/// Middleware to ensure request idempotency using an <c>X-Idempotency-Key</c> header.
/// Prevents accidental double-submissions of POST/PUT requests.
/// </summary>
/// <remarks>
/// Correctness is built on an <b>atomic reservation</b> rather than a check-then-act:
/// the first request for a key wins a Redis <c>SET key value NX</c>, every other
/// concurrent request observes the reservation and is rejected with <c>409 Conflict</c>
/// (the caller retries and then replays the cached response). This closes the race where
/// two simultaneous requests both missed the cache and both ran the side effect.
///
/// Failure handling: a request that throws, or that produces a non-2xx status, <b>releases</b>
/// its reservation so the operation can be retried; only a successful (2xx) response is cached
/// for replay. The reservation carries a short TTL so a crashed request cannot wedge a key
/// forever. Redis being unavailable fails <b>open</b> — the request proceeds without idempotency
/// rather than being blocked — matching the rest of the platform's cache-outage philosophy.
/// </remarks>
public sealed class IdempotencyMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IConnectionMultiplexer _redis;
    private readonly ILogger<IdempotencyMiddleware> _logger;

    private const string IdempotencyHeader = "X-Idempotency-Key";
    private const string KeyPrefix = "idempotency:";

    // Sentinel stored during the in-flight window. A key holding this value is "reserved
    // but not yet completed"; any other (JSON) value is a cached, replayable response.
    private const string PendingMarker = "pending";

    // The reservation lives only long enough to cover a request in flight; if the owning
    // request crashes, the key self-heals after this window so a retry can proceed.
    private static readonly TimeSpan PendingTtl = TimeSpan.FromMinutes(5);

    // A completed response stays replayable for a generous window after success.
    private static readonly TimeSpan CompletedTtl = TimeSpan.FromHours(24);

    private const string ConcurrentProblemJson =
        "{\"type\":\"https://tools.ietf.org/html/rfc9110#section-15.5.10\"," +
        "\"title\":\"Conflict\",\"status\":409," +
        "\"detail\":\"A request with the same idempotency key is already being processed.\"}";

    public IdempotencyMiddleware(RequestDelegate next, IConnectionMultiplexer redis, ILogger<IdempotencyMiddleware> logger)
    {
        _next = next;
        _redis = redis;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        if (context.Request.Method != HttpMethod.Post.Method && context.Request.Method != HttpMethod.Put.Method)
        {
            await _next(context);
            return;
        }

        if (!context.Request.Headers.TryGetValue(IdempotencyHeader, out var idempotencyKey) || string.IsNullOrEmpty(idempotencyKey))
        {
            await _next(context);
            return;
        }

        var userId = context.User?.FindFirst(ClaimTypes.NameIdentifier)?.Value
                     ?? context.User?.FindFirst("sub")?.Value
                     ?? "anonymous";
        var cacheKey = $"{KeyPrefix}{userId}:{idempotencyKey}";

        var db = _redis.GetDatabase();

        // Atomic reservation: only the first concurrent request for this key wins.
        bool reserved;
        try
        {
            reserved = await db.StringSetAsync(cacheKey, PendingMarker, PendingTtl, When.NotExists);
        }
        catch (Exception ex)
        {
            // Redis outage — never block the request because of an idempotency cache miss.
            _logger.LogWarning(ex,
                "Idempotency reservation failed (cache unavailable); proceeding without idempotency for key {Key}",
                (object)idempotencyKey);
            await _next(context);
            return;
        }

        if (!reserved)
        {
            await ReplayOrRejectAsync(context, db, cacheKey, idempotencyKey!);
            return;
        }

        // We own the reservation. Capture the response so we can cache a successful body and
        // always restore the original stream afterwards, even if the pipeline throws.
        var originalBodyStream = context.Response.Body;
        using var responseBodyStream = new MemoryStream();
        context.Response.Body = responseBodyStream;

        try
        {
            await _next(context);
        }
        catch
        {
            // Restore the real stream so upstream error handling writes a valid response,
            // and release the reservation so the failed operation can be retried.
            context.Response.Body = originalBodyStream;
            await ReleaseAsync(db, cacheKey);
            throw;
        }
        finally
        {
            context.Response.Body = originalBodyStream;
        }

        responseBodyStream.Seek(0, SeekOrigin.Begin);
        var responseBody = await new StreamReader(responseBodyStream).ReadToEndAsync();

        if (context.Response.StatusCode is >= 200 and < 300)
        {
            var resultToCache = new IdempotentResponse(context.Response.StatusCode, responseBody);
            try
            {
                await db.StringSetAsync(cacheKey, JsonSerializer.Serialize(resultToCache), CompletedTtl, When.Always);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to persist idempotent response for key {Key}", (object)idempotencyKey);
            }
        }
        else
        {
            // Do not cache failures: release so a retry with the same key can succeed.
            await ReleaseAsync(db, cacheKey);
        }

        responseBodyStream.Seek(0, SeekOrigin.Begin);
        await responseBodyStream.CopyToAsync(originalBodyStream);
    }

    private async Task ReplayOrRejectAsync(HttpContext context, IDatabase db, string cacheKey, string idempotencyKey)
    {
        RedisValue existing;
        try
        {
            existing = await db.StringGetAsync(cacheKey);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "Idempotency lookup failed (cache unavailable); proceeding without idempotency for key {Key}",
                (object)idempotencyKey);
            await _next(context);
            return;
        }

        var stored = existing.IsNullOrEmpty ? null : existing.ToString();
        if (stored is not null && stored != PendingMarker)
        {
            IdempotentResponse? response = null;
            try
            {
                response = JsonSerializer.Deserialize<IdempotentResponse>(stored);
            }
            catch (JsonException ex)
            {
                // A non-JSON / corrupted cached value must never surface as a 500. Treat it as
                // "no replayable response" and fall through to the in-flight/conflict path.
                _logger.LogWarning(ex, "Corrupted idempotency cache entry for key {Key}", (object)idempotencyKey);
            }

            if (response is not null)
            {
                _logger.LogInformation("Idempotent replay for key {Key}", (object)idempotencyKey);
                context.Response.StatusCode = response.StatusCode;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(response.Body);
                return;
            }
        }

        // The key is reserved by an in-flight request (or just expired between calls).
        _logger.LogInformation("Idempotent concurrent in-flight request rejected for key {Key}", (object)idempotencyKey);
        context.Response.StatusCode = StatusCodes.Status409Conflict;
        context.Response.ContentType = "application/problem+json";
        await context.Response.WriteAsync(ConcurrentProblemJson);
    }

    private async Task ReleaseAsync(IDatabase db, string cacheKey)
    {
        try
        {
            await db.KeyDeleteAsync(cacheKey);
        }
        catch (Exception ex)
        {
            // The reservation will self-heal at PendingTtl even if this fails.
            _logger.LogWarning(ex, "Failed to release idempotency reservation {Key}", cacheKey);
        }
    }

    private sealed record IdempotentResponse(int StatusCode, string Body);
}

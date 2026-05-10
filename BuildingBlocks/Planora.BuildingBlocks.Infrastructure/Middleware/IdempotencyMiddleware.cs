using Planora.BuildingBlocks.Domain;
using Microsoft.Extensions.Caching.Distributed;
using System.Text.Json;

namespace Planora.BuildingBlocks.Infrastructure.Middleware;

/// <summary>
/// Middleware to ensure request idempotency using an Idempotency-Key header.
/// Prevents accidental double-submissions of POST/PUT requests.
/// </summary>
public sealed class IdempotencyMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IDistributedCache _cache;
    private readonly ILogger<IdempotencyMiddleware> _logger;
    private const string IdempotencyHeader = "X-Idempotency-Key";

    public IdempotencyMiddleware(RequestDelegate next, IDistributedCache cache, ILogger<IdempotencyMiddleware> logger)
    {
        _next = next;
        _cache = cache;
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

        var userId = context.User?.FindFirst("sub")?.Value ?? "anonymous";
        var cacheKey = $"idempotency:{userId}:{idempotencyKey}";

        var cachedResponse = await _cache.GetStringAsync(cacheKey);
        if (cachedResponse != null)
        {
            _logger.LogInformation("Idempotent hit for key {Key}", (object)idempotencyKey);
            var response = JsonSerializer.Deserialize<IdempotentResponse>(cachedResponse);
            
            context.Response.StatusCode = response!.StatusCode;
            context.Response.ContentType = "application/json";
            await context.Response.WriteAsync(response.Body);
            return;
        }

        // Capture response
        var originalBodyStream = context.Response.Body;
        using var responseBodyStream = new MemoryStream();
        context.Response.Body = responseBodyStream;

        await _next(context);

        if (context.Response.StatusCode >= 200 && context.Response.StatusCode < 300)
        {
            responseBodyStream.Seek(0, SeekOrigin.Begin);
            var responseBody = await new StreamReader(responseBodyStream).ReadToEndAsync();
            responseBodyStream.Seek(0, SeekOrigin.Begin);

            var resultToCache = new IdempotentResponse(context.Response.StatusCode, responseBody);
            await _cache.SetStringAsync(cacheKey, JsonSerializer.Serialize(resultToCache), new DistributedCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(24)
            });

            await responseBodyStream.CopyToAsync(originalBodyStream);
        }
        else
        {
            responseBodyStream.Seek(0, SeekOrigin.Begin);
            await responseBodyStream.CopyToAsync(originalBodyStream);
        }
    }

    private sealed record IdempotentResponse(int StatusCode, string Body);
}

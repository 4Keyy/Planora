using System.Security.Cryptography;
using System.Text;

namespace Planora.BuildingBlocks.Infrastructure.Middleware;

/// <summary>
/// CSRF (Cross-Site Request Forgery) protection middleware implementing the
/// double-submit cookie pattern.
///
/// The frontend reads the XSRF-TOKEN cookie (non-httpOnly) and echoes its value
/// in the X-CSRF-Token request header. This middleware validates they match.
/// A cross-site attacker cannot read the cookie due to SameSite=Strict + CORS policy,
/// so they cannot forge the matching header.
/// </summary>
public sealed class CsrfProtectionMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<CsrfProtectionMiddleware> _logger;

    // Header the frontend echoes the token value in
    private const string CsrfHeaderName = "X-CSRF-Token";
    // Readable (non-httpOnly) cookie that holds the token
    private const string CsrfCookieName = "XSRF-TOKEN";

    public CsrfProtectionMiddleware(RequestDelegate next, ILogger<CsrfProtectionMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Only validate CSRF tokens on state-modifying requests
        if (IsStateModifyingRequest(context.Request.Method) && !IsGrpcRequest(context.Request))
        {
            if (!ValidateCsrfToken(context))
            {
                _logger.LogWarning(
                    "CSRF validation failed: Method={Method} Path={Path} IP={IP}",
                    context.Request.Method,
                    context.Request.Path,
                    context.Connection.RemoteIpAddress);
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.ContentType = "application/json";
                await context.Response.WriteAsync(
                    """{"error":"CSRF_VALIDATION_FAILED","message":"CSRF token validation failed"}""");
                return;
            }
        }

        await _next(context);
    }

    private static bool IsStateModifyingRequest(string method) =>
        method is "POST" or "PUT" or "DELETE" or "PATCH";

    private static bool IsGrpcRequest(HttpRequest request)
    {
        if (request.ContentType?.StartsWith("application/grpc", StringComparison.OrdinalIgnoreCase) == true)
        {
            return true;
        }

        // gRPC method paths are generated as "/{package}.{Service}/{Method}".
        // CSRF protects browser cookie flows; internal gRPC service calls do not use that contract.
        return request.Path.Value?.Contains(".", StringComparison.Ordinal) == true
               && request.Protocol.Equals("HTTP/2", StringComparison.OrdinalIgnoreCase);
    }

    private static bool ValidateCsrfToken(HttpContext context)
    {
        // Get CSRF token from request header (echoed by the frontend from the readable cookie)
        if (!context.Request.Headers.TryGetValue(CsrfHeaderName, out var headerToken)
            || string.IsNullOrWhiteSpace(headerToken))
        {
            return false;
        }

        // Get CSRF token from the readable XSRF-TOKEN cookie
        if (!context.Request.Cookies.TryGetValue(CsrfCookieName, out var cookieToken)
            || string.IsNullOrWhiteSpace(cookieToken))
        {
            return false;
        }

        // SECURITY: Use CryptographicOperations.FixedTimeEquals for timing-safe comparison.
        // A naive string == comparison can leak token length/content through timing side-channels.
        var headerBytes = Encoding.UTF8.GetBytes(headerToken.ToString());
        var cookieBytes = Encoding.UTF8.GetBytes(cookieToken);
        return headerBytes.Length == cookieBytes.Length
               && CryptographicOperations.FixedTimeEquals(headerBytes, cookieBytes);
    }
}

/// <summary>
/// Extension method to add CSRF protection middleware to the pipeline.
/// </summary>
public static class CsrfProtectionMiddlewareExtensions
{
    /// <summary>
    /// Adds CSRF protection middleware to validate tokens on state-modifying requests.
    /// The middleware should be added after authentication but before route handling.
    /// </summary>
    public static IApplicationBuilder UseCsrfProtection(this IApplicationBuilder app)
    {
        return app.UseMiddleware<CsrfProtectionMiddleware>();
    }
}

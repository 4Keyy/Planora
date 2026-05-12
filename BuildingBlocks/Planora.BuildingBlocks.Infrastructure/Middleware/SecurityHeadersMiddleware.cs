using Microsoft.AspNetCore.Hosting;

namespace Planora.BuildingBlocks.Infrastructure.Middleware;

public sealed class SecurityHeadersMiddleware
{
    private readonly RequestDelegate _next;
    private readonly IWebHostEnvironment _env;

    public SecurityHeadersMiddleware(RequestDelegate next, IWebHostEnvironment env)
    {
        _next = next;
        _env = env;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        // Prevent clickjacking
        context.Response.Headers.Append("X-Frame-Options", "DENY");
        // Prevent MIME-type sniffing
        context.Response.Headers.Append("X-Content-Type-Options", "nosniff");
        // X-XSS-Protection is legacy (modern browsers use CSP), but kept for older browsers
        context.Response.Headers.Append("X-XSS-Protection", "1; mode=block");
        // Control Referer header in cross-origin navigations
        context.Response.Headers.Append("Referrer-Policy", "strict-origin-when-cross-origin");
        // Restrict browser feature access
        context.Response.Headers.Append("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        // CSP: restrict resource origins to self; frame-ancestors replaces X-Frame-Options
        context.Response.Headers.Append(
            "Content-Security-Policy",
            "default-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self';");

        // SECURITY: HSTS — only set in non-development environments.
        // When UseHttpsRedirection() runs before this middleware, requests are always
        // HTTPS in production, so we do not need to gate on context.Request.IsHttps.
        if (!_env.IsDevelopment())
        {
            context.Response.Headers.Append(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains; preload");
        }

        await _next(context);
    }
}

public static class SecurityHeadersMiddlewareExtensions
{
    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app)
        => app.UseMiddleware<SecurityHeadersMiddleware>();
}

using Microsoft.AspNetCore.Mvc.Filters;

namespace Planora.Auth.Api.Filters
{
    public sealed class TokenBlacklistFilter : IAsyncActionFilter
    {
        private readonly ITokenBlacklistService _tokenBlacklistService;
        private readonly ILogger<TokenBlacklistFilter> _logger;

        public TokenBlacklistFilter(
            ITokenBlacklistService tokenBlacklistService,
            ILogger<TokenBlacklistFilter> logger)
        {
            _tokenBlacklistService = tokenBlacklistService;
            _logger = logger;
        }

        public async Task OnActionExecutionAsync(
            ActionExecutingContext context,
            ActionExecutionDelegate next)
        {
            var token = ExtractToken(context.HttpContext);

            if (!string.IsNullOrEmpty(token))
            {
                var isBlacklisted = await _tokenBlacklistService.IsTokenBlacklistedAsync(token);

                if (isBlacklisted)
                {
                    _logger.LogWarning("Attempt to use blacklisted token");

                    context.Result = new UnauthorizedObjectResult(new
                    {
                        error = "TOKEN_REVOKED",
                        message = "This token has been revoked"
                    });

                    return;
                }
            }

            await next();
        }

        private static string? ExtractToken(HttpContext context)
        {
            var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();

            if (authHeader?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true)
            {
                return authHeader.Substring("Bearer ".Length).Trim();
            }

            return null;
        }
    }
}

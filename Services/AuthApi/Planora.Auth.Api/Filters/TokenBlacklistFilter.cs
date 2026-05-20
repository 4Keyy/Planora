using Microsoft.AspNetCore.Mvc.Filters;
using Planora.Auth.Application.Common.Interfaces;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace Planora.Auth.Api.Filters
{
    public sealed class TokenBlacklistFilter : IAsyncActionFilter
    {
        private readonly ITokenBlacklistService _tokenBlacklistService;
        private readonly ISecurityStampService _securityStamp;
        private readonly ILogger<TokenBlacklistFilter> _logger;

        public TokenBlacklistFilter(
            ITokenBlacklistService tokenBlacklistService,
            ISecurityStampService securityStamp,
            ILogger<TokenBlacklistFilter> logger)
        {
            _tokenBlacklistService = tokenBlacklistService;
            _securityStamp = securityStamp;
            _logger = logger;
        }

        public async Task OnActionExecutionAsync(
            ActionExecutingContext context,
            ActionExecutionDelegate next)
        {
            var rawToken = ExtractToken(context.HttpContext);

            if (!string.IsNullOrEmpty(rawToken))
            {
                var isBlacklisted = await _tokenBlacklistService.IsTokenBlacklistedAsync(rawToken);
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

                // Reject tokens issued before the last password change/reset
                if (await IsIssuedBeforeSecurityStampAsync(rawToken))
                {
                    _logger.LogWarning("Attempt to use token issued before security stamp change");
                    context.Result = new UnauthorizedObjectResult(new
                    {
                        error = "TOKEN_REVOKED",
                        message = "This token has been revoked due to a security event"
                    });
                    return;
                }
            }

            await next();
        }

        private async Task<bool> IsIssuedBeforeSecurityStampAsync(string rawToken)
        {
            try
            {
                var handler = new JwtSecurityTokenHandler();
                if (!handler.CanReadToken(rawToken)) return false;

                var jwt = handler.ReadJwtToken(rawToken);
                var subClaim = jwt.Claims.FirstOrDefault(c => c.Type is ClaimTypes.NameIdentifier or "sub")?.Value;
                if (subClaim is null || !Guid.TryParse(subClaim, out var userId)) return false;

                var stamp = await _securityStamp.GetStampAsync(userId);
                if (stamp is null) return false;

                // iat is Unix seconds
                var iatClaim = jwt.Claims.FirstOrDefault(c => c.Type == "iat")?.Value;
                if (iatClaim is null || !long.TryParse(iatClaim, out var iatSeconds)) return false;

                var issuedAt = DateTimeOffset.FromUnixTimeSeconds(iatSeconds).UtcDateTime;
                return issuedAt < stamp.Value;
            }
            catch
            {
                return false;
            }
        }

        private static string? ExtractToken(HttpContext context)
        {
            var authHeader = context.Request.Headers["Authorization"].FirstOrDefault();
            return authHeader?.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) == true
                ? authHeader["Bearer ".Length..].Trim()
                : null;
        }
    }
}

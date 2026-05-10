using Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset;
using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;
using Planora.Auth.Application.Features.Authentication.Response;
using Planora.Auth.Application.Features.Authentication.Response.Login;
using Planora.Auth.Application.Features.Authentication.Response.Register;
using Microsoft.AspNetCore.RateLimiting;

namespace Planora.Auth.Api.Controllers
{
    [ApiController]
    [Route("api/v1/[controller]")]
    [Produces("application/json")]
    public sealed class AuthenticationController : ControllerBase
    {
        private readonly IMediator _mediator;
        private readonly ILogger<AuthenticationController> _logger;

        public AuthenticationController(
            IMediator mediator,
            ILogger<AuthenticationController> logger)
        {
            _mediator = mediator;
            _logger = logger;
        }

        [HttpPost("register")]
        [AllowAnonymous]
        [EnableRateLimiting("register")]
        [ProducesResponseType(typeof(RegisterResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> Register(
            [FromBody] RegisterCommand command,
            CancellationToken cancellationToken)
        {
            _logger.LogInformation("📝 Registration attempt: {Email}", command.Email);

            var result = await _mediator.Send(command, cancellationToken);
            
            if (result.IsFailure)
            {
                return result.Error!.Code switch
                {
                    var c when c.Contains("ALREADY_EXISTS") || c.Contains("DUPLICATE") => Conflict(new { error = result.Error.Message, code = result.Error.Code }),
                    _ => BadRequest(new { error = result.Error.Message, code = result.Error.Code })
                };
            }
            
            var registerValue = result.Value!;

            Response.Cookies.Append("refresh_token", registerValue.RefreshToken, new CookieOptions
            {
                HttpOnly = true,
                Secure = HttpContext.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                Path = "/auth/api/v1/auth",
            });

            return Ok(new
            {
                registerValue.AccessToken,
                registerValue.UserId,
                registerValue.Email,
                registerValue.FirstName,
                registerValue.LastName,
                registerValue.ExpiresAt,
            });
        }

        [HttpPost("login")]
        [AllowAnonymous]
        [EnableRateLimiting("login")]
        [ProducesResponseType(typeof(LoginResponse), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> Login(
            [FromBody] LoginCommand command,
            CancellationToken cancellationToken)
        {
            _logger.LogInformation("Login attempt: {Email}", command.Email);

            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return Unauthorized(new { error = result.Error!.Message, code = result.Error.Code });
            }

            // SECURITY: Set the refresh token as an httpOnly, Secure, SameSite=Strict cookie.
            // This prevents JavaScript from ever reading the refresh token, which eliminates
            // the entire class of XSS-based token theft for long-lived credentials.
            // Cookie type depends on RememberMe: persistent (survives browser restart) vs
            // session-only (cleared when browser closes).
            var loginValue = result.Value!;
            var refreshToken = loginValue.RefreshToken;

            var cookieOptions = new CookieOptions
            {
                HttpOnly = true,
                Secure = HttpContext.Request.IsHttps, // Secure in production (HTTPS)
                SameSite = SameSiteMode.Strict,
                Path = "/auth/api/v1/auth", // Scope cookie to auth endpoints only
            };

            if (command.RememberMe)
            {
                // Persistent cookie: survives browser restart, expires with the refresh token
                cookieOptions.Expires = new DateTimeOffset(loginValue.ExpiresAt, TimeSpan.Zero);
            }
            // else: no Expires attribute → session cookie, cleared when browser closes

            Response.Cookies.Append("refresh_token", refreshToken, cookieOptions);

            // Do NOT include the refresh token in the JSON body — frontend must not see it
            return Ok(new
            {
                loginValue.AccessToken,
                loginValue.UserId,
                loginValue.Email,
                loginValue.FirstName,
                loginValue.LastName,
                loginValue.ExpiresAt,
                loginValue.TwoFactorEnabled,
            });
        }

        [HttpPost("refresh")]
        [AllowAnonymous]
        [EnableRateLimiting("auth")]
        [ProducesResponseType(typeof(TokenDto), StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status204NoContent)]
        [ProducesResponseType(StatusCodes.Status401Unauthorized)]
        public async Task<IActionResult> RefreshToken(
            CancellationToken cancellationToken)
        {
            // SECURITY: Read refresh token from the httpOnly cookie, not the request body.
            // This means the token is never accessible to JavaScript on the client.
            if (!Request.Cookies.TryGetValue("refresh_token", out var cookieRefreshToken)
                || string.IsNullOrWhiteSpace(cookieRefreshToken))
            {
                return NoContent();
            }

            var command = new RefreshTokenCommand { RefreshToken = cookieRefreshToken };
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                // Clear the invalid cookie
                Response.Cookies.Delete("refresh_token", new CookieOptions { Path = "/auth/api/v1/auth" });
                return result.Error!.Code switch
                {
                    var c when c.Contains("NOT_FOUND") => NotFound(new { error = result.Error.Message, code = result.Error.Code }),
                    var c when c.Contains("INVALID") => BadRequest(new { error = result.Error.Message, code = result.Error.Code }),
                    _ => Unauthorized(new { error = result.Error.Message, code = result.Error.Code })
                };
            }

            // SECURITY: Rotate the refresh token cookie (token rotation prevents replay attacks).
            // Preserve the original RememberMe intent: persistent cookie if true, session cookie if false.
            var tokenValue = result.Value!;

            var refreshCookieOptions = new CookieOptions
            {
                HttpOnly = true,
                Secure = HttpContext.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                Path = "/auth/api/v1/auth",
            };

            if (tokenValue.RememberMe)
            {
                // Persistent cookie: survives browser restart, expires with the new refresh token
                refreshCookieOptions.Expires = new DateTimeOffset(tokenValue.ExpiresAt, TimeSpan.Zero);
            }
            // else: no Expires attribute → session cookie, cleared when browser closes

            Response.Cookies.Append("refresh_token", tokenValue.RefreshToken, refreshCookieOptions);

            // Return only the new access token; do NOT include the refresh token in the body.
            // Include rememberMe so the frontend can update its refreshTokenExpiresAt state correctly.
            return Ok(new
            {
                tokenValue.AccessToken,
                tokenValue.ExpiresAt,
                tokenValue.TokenType,
                tokenValue.RememberMe,
            });
        }

        [HttpPost("logout")]
        [Authorize]
        [EnableRateLimiting("auth")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> Logout(
            [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] LogoutCommand? command,
            CancellationToken cancellationToken)
        {
            var userId = User.FindFirst("sub")?.Value;
            _logger.LogInformation("Logout: UserId={UserId}", userId);

            Request.Cookies.TryGetValue("refresh_token", out var cookieRefreshToken);
            var refreshToken = !string.IsNullOrWhiteSpace(cookieRefreshToken)
                ? cookieRefreshToken
                : command?.RefreshToken;

            var logoutCommand = (command ?? new LogoutCommand()) with
            {
                RefreshToken = refreshToken
            };

            var result = await _mediator.Send(logoutCommand, cancellationToken);

            // SECURITY: Always clear the httpOnly refresh-token cookie on logout,
            // regardless of whether the server-side revocation succeeded.
            // This ensures the client cannot silently re-authenticate after logout.
            Response.Cookies.Delete("refresh_token", new CookieOptions
            {
                HttpOnly = true,
                Secure = HttpContext.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                Path = "/auth/api/v1/auth",
            });

            if (result.IsFailure)
            {
                return StatusCode(StatusCodes.Status500InternalServerError, new { error = result.Error!.Message, code = result.Error.Code });
            }

            return Ok(new { message = "Logged out successfully" });
        }

        [HttpPost("validate-token")]
        [AllowAnonymous]
        [EnableRateLimiting("auth")]
        [ProducesResponseType(typeof(TokenValidationDto), StatusCodes.Status200OK)]
        public async Task<IActionResult> ValidateToken(
            [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] ValidateTokenQuery? query,
            CancellationToken cancellationToken)
        {
            var token = !string.IsNullOrWhiteSpace(query?.Token)
                ? query.Token
                : ExtractBearerToken(Request.Headers.Authorization.ToString());

            var result = await _mediator.Send(
                new ValidateTokenQuery { Token = token ?? string.Empty },
                cancellationToken);
            
            if (result.IsFailure)
            {
                return BadRequest(new { error = result.Error!.Message, code = result.Error.Code });
            }
            
            return Ok(result.Value);
        }

        private static string? ExtractBearerToken(string? authorizationHeader)
        {
            const string bearerPrefix = "Bearer ";

            if (string.IsNullOrWhiteSpace(authorizationHeader)
                || !authorizationHeader.StartsWith(bearerPrefix, StringComparison.OrdinalIgnoreCase))
            {
                return null;
            }

            var token = authorizationHeader[bearerPrefix.Length..].Trim();
            return string.IsNullOrWhiteSpace(token) ? null : token;
        }

        [HttpPost("request-password-reset")]
        [AllowAnonymous]
        [EnableRateLimiting("auth")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        public async Task<IActionResult> RequestPasswordReset(
            [FromBody] RequestPasswordResetCommand command,
            CancellationToken cancellationToken)
        {
            _logger.LogInformation("🔑 Password reset requested: {Email}", command.Email);

            await _mediator.Send(command, cancellationToken);

            return Ok(new
            {
                message = "If the email exists, a password reset link has been sent."
            });
        }

        /// <summary>
        /// Generates a CSRF token using the double-submit cookie pattern.
        ///
        /// SECURITY: This implements the double-submit cookie pattern:
        /// 1. A cryptographically random token is generated.
        /// 2. The token is set as a non-httpOnly cookie (readable by JS) so the frontend
        ///    can read and echo it back in the X-CSRF-Token request header.
        /// 3. The CsrfProtectionMiddleware validates that the X-CSRF-Token header value
        ///    matches the XSRF-TOKEN cookie value on every state-modifying request.
        ///
        /// Cross-site requests cannot read the cookie (SameSite=Strict + CORS) so they
        /// cannot reproduce the matching header, blocking CSRF attacks.
        /// </summary>
        [HttpGet("csrf-token")]
        [AllowAnonymous]
        [ProducesResponseType(typeof(CsrfTokenResponse), StatusCodes.Status200OK)]
        [DisableRateLimiting]
        public IActionResult GetCsrfToken()
        {
            var csrfToken = Convert.ToBase64String(
                System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));

            // SECURITY: Set a readable (non-httpOnly) cookie so the frontend JS can read
            // the value and echo it in the X-CSRF-Token header (double-submit cookie pattern).
            // SameSite=Strict prevents cross-site pages from triggering requests that carry
            // this cookie, closing the CSRF attack vector even without the header check.
            Response.Cookies.Append("XSRF-TOKEN", csrfToken, new CookieOptions
            {
                HttpOnly = false,           // Must be readable by JavaScript
                Secure = HttpContext.Request.IsHttps,
                SameSite = SameSiteMode.Strict,
                Expires = DateTimeOffset.UtcNow.AddHours(1),
                Path = "/",
            });

            return Ok(new CsrfTokenResponse
            {
                Token = csrfToken,
                ExpiresIn = 3600
            });
        }

        [HttpPost("reset-password")]
        [AllowAnonymous]
        [EnableRateLimiting("auth")]
        [ProducesResponseType(StatusCodes.Status200OK)]
        [ProducesResponseType(StatusCodes.Status400BadRequest)]
        public async Task<IActionResult> ResetPassword(
            [FromBody] ResetPasswordCommand command,
            CancellationToken cancellationToken)
        {
            var result = await _mediator.Send(command, cancellationToken);

            if (result.IsFailure)
            {
                return BadRequest(result.Error);
            }

            return Ok(new { message = "Password has been reset successfully" });
        }
    }
}

namespace Planora.BuildingBlocks.Infrastructure.Configuration;

/// <summary>
/// Application constants for security, timing, and configuration values.
/// Centralizes magic numbers and strings to facilitate easy updates.
/// </summary>
public static class SecurityConstants
{
    /// <summary>
    /// JWT claim names following OpenID Connect standards
    /// </summary>
    public static class Claims
    {
        /// <summary>
        /// Subject claim - uniquely identifies the principal (user ID)
        /// </summary>
        public const string Subject = "sub";

        /// <summary>
        /// Email address claim
        /// </summary>
        public const string Email = "email";

        /// <summary>
        /// Given name claim (first name)
        /// </summary>
        public const string GivenName = "given_name";

        /// <summary>
        /// Family name claim (last name)
        /// </summary>
        public const string FamilyName = "family_name";

        /// <summary>
        /// Role claim for RBAC
        /// </summary>
        public const string Role = "role";

        /// <summary>
        /// Issued at timestamp
        /// </summary>
        public const string IssuedAt = "iat";

        /// <summary>
        /// Expiration time timestamp
        /// </summary>
        public const string Expiration = "exp";
    }

    /// <summary>
    /// Password validation and hashing constants
    /// </summary>
    public static class PasswordHashing
    {
        /// <summary>
        /// PBKDF2 salt size in bytes
        /// </summary>
        public const int SaltSize = 16;

        /// <summary>
        /// PBKDF2 hash size in bytes
        /// </summary>
        public const int HashSize = 32;

        /// <summary>
        /// PBKDF2 iteration count (should be high to slow down brute force)
        /// Review annually and increase as hardware improves
        /// </summary>
        public const int Iterations = 100_000;

        /// <summary>
        /// Minimum password length
        /// </summary>
        public const int MinLength = 8;

        /// <summary>
        /// Maximum password length
        /// </summary>
        public const int MaxLength = 128;
    }

    /// <summary>
    /// Token expiration times
    /// </summary>
    public static class TokenExpiration
    {
        /// <summary>
        /// Access token lifetime in minutes
        /// </summary>
        public const int AccessTokenMinutes = 60;

        /// <summary>
        /// Refresh token lifetime in days
        /// </summary>
        public const int RefreshTokenDays = 7;

        /// <summary>
        /// Password reset token lifetime in minutes
        /// </summary>
        public const int PasswordResetTokenMinutes = 30;

        /// <summary>
        /// Email verification token lifetime in hours
        /// </summary>
        public const int EmailVerificationTokenHours = 24;
    }

    /// <summary>
    /// Security policies and limits
    /// </summary>
    public static class SecurityPolicies
    {
        /// <summary>
        /// Maximum failed login attempts before lockout
        /// </summary>
        public const int MaxFailedLoginAttempts = 5;

        /// <summary>
        /// Account lockout duration in minutes after max failed attempts
        /// </summary>
        public const int AccountLockoutMinutes = 30;

        /// <summary>
        /// Clock skew tolerance for token validation in seconds
        /// </summary>
        public const int TokenClockSkewSeconds = 5;

        /// <summary>
        /// Maximum request body size in bytes (5 MB)
        /// </summary>
        public const long MaxRequestBodySize = 5 * 1024 * 1024;

        /// <summary>
        /// Rate limit: requests per window
        /// </summary>
        public const int RateLimitRequestsPerMinute = 100;

        /// <summary>
        /// Rate limit window in minutes
        /// </summary>
        public const int RateLimitWindowMinutes = 1;
    }

    /// <summary>
    /// HTTP Headers for security
    /// </summary>
    public static class SecurityHeaders
    {
        /// <summary>
        /// CSRF token header name
        /// </summary>
        public const string CsrfTokenHeader = "X-CSRF-Token";

        /// <summary>
        /// Correlation ID header name for request tracing
        /// </summary>
        public const string CorrelationIdHeader = "X-Correlation-ID";

        /// <summary>
        /// Request ID header name
        /// </summary>
        public const string RequestIdHeader = "X-Request-ID";
    }

    /// <summary>
    /// HTTP Status codes (for documentation)
    /// </summary>
    public static class HttpStatusCodes
    {
        public const int Ok = 200;
        public const int Created = 201;
        public const int BadRequest = 400;
        public const int Unauthorized = 401;
        public const int Forbidden = 403;
        public const int NotFound = 404;
        public const int Conflict = 409;
        public const int InternalServerError = 500;
        public const int ServiceUnavailable = 503;
    }
}

/// <summary>
/// Feature flags and feature toggle constants
/// </summary>
public static class FeatureFlags
{
    /// <summary>
    /// Enable two-factor authentication
    /// </summary>
    public const string TwoFactorAuthentication = "feature:two-factor-auth";

    /// <summary>
    /// Enable passwordless authentication
    /// </summary>
    public const string PasswordlessAuthentication = "feature:passwordless-auth";

    /// <summary>
    /// Enable OAuth integration
    /// </summary>
    public const string OAuthIntegration = "feature:oauth-integration";
}

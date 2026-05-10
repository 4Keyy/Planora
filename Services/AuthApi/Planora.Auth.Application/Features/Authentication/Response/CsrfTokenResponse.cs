namespace Planora.Auth.Application.Features.Authentication.Response
{
    /// <summary>
    /// Response for CSRF token requests.
    /// 
    /// SECURITY: This token must be included in the X-CSRF-Token header for all
    /// state-modifying requests to prevent cross-site request forgery attacks.
    /// </summary>
    public class CsrfTokenResponse
    {
        /// <summary>
        /// The CSRF token to include in request headers.
        /// </summary>
        public string Token { get; set; } = string.Empty;

        /// <summary>
        /// Token expiration time in seconds.
        /// After this time, a new token must be obtained.
        /// </summary>
        public int ExpiresIn { get; set; } = 3600; // 1 hour
    }
}

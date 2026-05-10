namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record TokenDto
    {
        public string AccessToken { get; init; } = string.Empty;

        public string RefreshToken { get; init; } = string.Empty;

        public DateTime ExpiresAt { get; init; }

        public string TokenType { get; init; } = "Bearer";

        public bool RememberMe { get; init; }
    }
}

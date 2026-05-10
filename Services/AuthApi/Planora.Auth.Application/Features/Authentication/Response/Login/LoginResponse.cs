namespace Planora.Auth.Application.Features.Authentication.Response.Login
{
    public sealed record LoginResponse
    {
        public Guid UserId { get; init; }
        public string Email { get; init; } = string.Empty;
        public string FirstName { get; init; } = string.Empty;
        public string LastName { get; init; } = string.Empty;
        public string AccessToken { get; init; } = string.Empty;
        public string RefreshToken { get; init; } = string.Empty;
        public DateTime ExpiresAt { get; init; }
        public bool TwoFactorEnabled { get; init; }
    }
}

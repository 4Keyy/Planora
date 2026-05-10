namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record RefreshTokenDto
    {
        public Guid Id { get; init; }

        public string Token { get; init; } = string.Empty;

        public DateTime ExpiresAt { get; init; }

        public DateTime CreatedAt { get; init; }

        public string CreatedByIp { get; init; } = string.Empty;

        public bool IsActive { get; init; }

        public bool IsExpired { get; init; }
    }
}

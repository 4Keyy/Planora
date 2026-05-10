namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record RefreshTokenDetailDto
    {
        public Guid Id { get; init; }

        public string Token { get; init; } = string.Empty;

        public DateTime ExpiresAt { get; init; }

        public DateTime CreatedAt { get; init; }

        public string CreatedByIp { get; init; } = string.Empty;

        public bool IsActive { get; init; }

        public bool IsExpired { get; init; }

        public bool IsRevoked { get; init; }

        public DateTime? RevokedAt { get; init; }

        public string? RevokedByIp { get; init; }

        public string? RevokedReason { get; init; }

        public string? ReplacedByToken { get; init; }
    }
}

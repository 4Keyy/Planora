namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record UserSecurityDto
    {
        public Guid UserId { get; init; }

        public bool TwoFactorEnabled { get; init; }

        public int ActiveSessionsCount { get; init; }

        public DateTime? LastPasswordChange { get; init; }

        public DateTime? LastEmailChange { get; init; }

        public int FailedLoginAttempts { get; init; }

        public DateTime? LockedUntil { get; init; }

        public IReadOnlyList<RefreshTokenDetailDto> ActiveTokens { get; init; } = new List<RefreshTokenDetailDto>();

        public IReadOnlyList<LoginHistoryDto> RecentLogins { get; init; } = new List<LoginHistoryDto>();
    }
}

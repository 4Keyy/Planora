namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record UserDetailDto
    {
        public Guid Id { get; init; }

        public string Email { get; init; } = string.Empty;

        public string FirstName { get; init; } = string.Empty;

        public string LastName { get; init; } = string.Empty;

        public string FullName => $"{FirstName} {LastName}";

        public string? ProfilePictureUrl { get; init; }

        public string Status { get; init; } = string.Empty;

        public bool IsEmailVerified { get; init; }

        public DateTime? EmailVerifiedAt { get; init; }

        public DateTime? LastLoginAt { get; init; }

        public bool TwoFactorEnabled { get; init; }

        public int FailedLoginAttempts { get; init; }

        public DateTime? LockedUntil { get; init; }

        public DateTime CreatedAt { get; init; }

        public DateTime? UpdatedAt { get; init; }

        public List<LoginHistoryDto> RecentLogins { get; init; } = new();
    }
}

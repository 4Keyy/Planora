namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record UserDto
    {
        public Guid Id { get; init; }

        public string Email { get; init; } = string.Empty;

        public string FirstName { get; init; } = string.Empty;

        public string LastName { get; init; } = string.Empty;

        public string? ProfilePictureUrl { get; init; }

        public string Status { get; init; } = string.Empty;

        public bool IsEmailVerified { get; init; }

        public DateTime? EmailVerifiedAt { get; init; }

        public DateTime? LastLoginAt { get; init; }

        public bool TwoFactorEnabled { get; init; }

        public DateTime CreatedAt { get; init; }
    }
}

namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record UserListDto
    {
        public Guid Id { get; init; }

        public string Email { get; init; } = string.Empty;

        public string FirstName { get; init; } = string.Empty;

        public string LastName { get; init; } = string.Empty;

        public string FullName => $"{FirstName} {LastName}";

        public string Status { get; init; } = string.Empty;

        public DateTime? LastLoginAt { get; init; }

        public DateTime CreatedAt { get; init; }
    }
}

namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record TokenValidationDto
    {
        public bool IsValid { get; init; }

        public Guid? UserId { get; init; }

        public string? Email { get; init; }

        public DateTime? ExpiresAt { get; init; }

        public string? Message { get; init; }

        public IEnumerable<string>? Roles { get; init; }
    }
}

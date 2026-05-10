namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record SessionDto
    {
        public Guid Id { get; init; }

        public string DeviceName { get; init; } = string.Empty;

        public string Browser { get; init; } = string.Empty;

        public string IpAddress { get; init; } = string.Empty;

        public string Location { get; init; } = string.Empty;

        public bool IsCurrent { get; init; }

        public DateTime CreatedAt { get; init; }

        public DateTime? LastActivityAt { get; init; }

        public DateTime ExpiresAt { get; init; }
    }
}

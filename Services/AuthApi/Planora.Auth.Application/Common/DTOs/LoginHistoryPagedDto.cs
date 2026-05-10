namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record LoginHistoryPagedDto
    {
        public Guid Id { get; init; }

        public string IpAddress { get; init; } = string.Empty;

        public string UserAgent { get; init; } = string.Empty;

        public bool IsSuccessful { get; init; }

        public DateTime LoginAt { get; init; }

        public string? FailureReason { get; init; }

        public string Location { get; init; } = string.Empty;

        public string Device { get; init; } = string.Empty;

        public string Browser { get; init; } = string.Empty;
    }
}

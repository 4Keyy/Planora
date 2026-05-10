namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record LoginHistoryDto
    {
        public Guid Id { get; init; }

        public string IpAddress { get; init; } = string.Empty;

        public string UserAgent { get; init; } = string.Empty;

        public bool IsSuccessful { get; init; }

        public DateTime LoginAt { get; init; }

        public string? FailureReason { get; init; }
    }
}

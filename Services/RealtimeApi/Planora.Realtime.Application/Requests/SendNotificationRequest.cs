namespace Planora.Realtime.Application.Requests
{
    public sealed record SendNotificationRequest
    {
        public string Message { get; init; } = string.Empty;
        public string Type { get; init; } = "info";
    }
}

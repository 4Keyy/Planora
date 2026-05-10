namespace Planora.Realtime.Application.Response
{
    public sealed record ConnectionInfo
    {
        public string ConnectionId { get; init; } = string.Empty;
        public DateTime ConnectedAt { get; init; }
    }
}

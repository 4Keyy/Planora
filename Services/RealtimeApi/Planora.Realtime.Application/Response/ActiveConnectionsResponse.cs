namespace Planora.Realtime.Application.Response
{
    public sealed record ActiveConnectionsResponse
    {
        public string UserId { get; init; } = string.Empty;
        public int ConnectionCount { get; init; }
        public List<ConnectionInfo> Connections { get; init; } = new();
    }
}

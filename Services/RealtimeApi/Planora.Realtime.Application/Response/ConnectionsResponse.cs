namespace Planora.Realtime.Application.Response
{
    public sealed record ConnectionsResponse
    {
        public int ActiveConnections { get; init; }
        public List<string> ConnectionIds { get; init; } = new();
    }
}

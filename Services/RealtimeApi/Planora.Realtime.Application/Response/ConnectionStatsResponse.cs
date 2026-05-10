namespace Planora.Realtime.Application.Response
{
    public sealed record ConnectionStatsResponse
    {
        public int TotalConnections { get; init; }
        public DateTime Timestamp { get; init; }
    }
}

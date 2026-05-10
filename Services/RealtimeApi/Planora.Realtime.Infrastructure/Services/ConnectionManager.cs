namespace Planora.Realtime.Infrastructure.Services
{
    public sealed class ConnectionManager : IConnectionManager
    {
        private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _userConnections = new();
        private readonly ILogger<ConnectionManager> _logger;

        public ConnectionManager(ILogger<ConnectionManager> logger)
        {
            _logger = logger;
        }

        public Task AddConnectionAsync(string userId, string connectionId)
        {
            _userConnections.AddOrUpdate(
                userId,
                _ =>
                {
                    var set = new ConcurrentDictionary<string, byte>();
                    set.TryAdd(connectionId, 0);
                    _logger.LogInformation("User {UserId} connected: {ConnectionId}", userId, connectionId);
                    return set;
                },
                (_, existing) =>
                {
                    existing.TryAdd(connectionId, 0);
                    _logger.LogInformation("User {UserId} added connection: {ConnectionId}", userId, connectionId);
                    return existing;
                });

            return Task.CompletedTask;
        }

        public Task RemoveConnectionAsync(string userId, string connectionId)
        {
            if (_userConnections.TryGetValue(userId, out var connections))
            {
                connections.TryRemove(connectionId, out _);

                if (!connections.Any())
                {
                    _userConnections.TryRemove(userId, out _);
                    _logger.LogInformation("User {UserId} fully disconnected", userId);
                }
                else
                {
                    _logger.LogInformation("User {UserId} removed connection: {ConnectionId}", userId, connectionId);
                }
            }

            return Task.CompletedTask;
        }

        public List<string> GetUserConnections(string userId)
        {
            return _userConnections.TryGetValue(userId, out var connections)
                ? connections.Keys.ToList()
                : new List<string>();
        }

        public int GetTotalConnections()
        {
            return _userConnections.Values.Sum(c => c.Count);
        }
    }
}

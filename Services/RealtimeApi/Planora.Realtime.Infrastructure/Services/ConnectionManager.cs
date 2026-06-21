namespace Planora.Realtime.Infrastructure.Services
{
    public sealed class ConnectionManager : IConnectionManager
    {
        private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _userConnections = new();

        // Serialises the per-user bucket lifecycle (create on first add / remove when empty). Without
        // it, RemoveConnection could observe an empty bucket and remove the user key while a racing
        // AddConnection added a connection to that same bucket — orphaning the live connection. The
        // section is tiny and add/remove are not a hot path, so a single gate is simplest and correct.
        private readonly object _gate = new();
        private readonly ILogger<ConnectionManager> _logger;

        public ConnectionManager(ILogger<ConnectionManager> logger)
        {
            _logger = logger;
        }

        public Task AddConnectionAsync(string userId, string connectionId)
        {
            bool firstConnection;
            lock (_gate)
            {
                if (!_userConnections.TryGetValue(userId, out var connections))
                {
                    connections = new ConcurrentDictionary<string, byte>();
                    _userConnections[userId] = connections;
                    firstConnection = true;
                }
                else
                {
                    firstConnection = false;
                }

                connections.TryAdd(connectionId, 0);
            }

            _logger.LogInformation(
                firstConnection
                    ? "User {UserId} connected: {ConnectionId}"
                    : "User {UserId} added connection: {ConnectionId}",
                userId, connectionId);

            return Task.CompletedTask;
        }

        public Task RemoveConnectionAsync(string userId, string connectionId)
        {
            bool fullyDisconnected = false;
            bool removed = false;

            lock (_gate)
            {
                if (_userConnections.TryGetValue(userId, out var connections))
                {
                    removed = true;
                    connections.TryRemove(connectionId, out _);

                    // Inside the lock no AddConnection can repopulate the bucket between the
                    // emptiness check and the key removal, so a live connection is never orphaned.
                    if (connections.IsEmpty)
                    {
                        _userConnections.TryRemove(userId, out _);
                        fullyDisconnected = true;
                    }
                }
            }

            if (fullyDisconnected)
                _logger.LogInformation("User {UserId} fully disconnected", userId);
            else if (removed)
                _logger.LogInformation("User {UserId} removed connection: {ConnectionId}", userId, connectionId);

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

using Microsoft.Extensions.Hosting;
using Planora.BuildingBlocks.Infrastructure.Security;
using Planora.Realtime.Infrastructure.Hubs;
using StackExchange.Redis;

namespace Planora.Realtime.Infrastructure.Services;

/// <summary>Tracks only this instance's sockets; SignalR still owns cross-node message routing.</summary>
public sealed class RealtimeSessionMonitor(
    IConnectionMultiplexer redis,
    IConnectionManager connectionManager,
    IHubContext<NotificationHub> hubContext,
    TimeProvider timeProvider,
    ILogger<RealtimeSessionMonitor> logger) : BackgroundService
{
    public static readonly TimeSpan RevalidationInterval = TimeSpan.FromSeconds(15);
    private readonly ConcurrentDictionary<string, HubCallerContext> _connections = new();

    public int TrackedConnectionCount => _connections.Count;

    public void Register(HubCallerContext context) => _connections[context.ConnectionId] = context;

    public void Unregister(string connectionId) => _connections.TryRemove(connectionId, out _);

    public async Task<bool> ValidateAsync(HubCallerContext context, CancellationToken cancellationToken = default,
        bool abortInvalid = true)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var rawExpiry = context.User?.FindFirst("exp")?.Value;
        var current = long.TryParse(rawExpiry, System.Globalization.NumberStyles.None,
            System.Globalization.CultureInfo.InvariantCulture, out var expiry) &&
            expiry > timeProvider.GetUtcNow().ToUnixTimeSeconds();
        if (current)
            current = !await SecurityStampValidator.IsTokenRevokedAsync(redis, context.User)
                .WaitAsync(cancellationToken) && expiry > timeProvider.GetUtcNow().ToUnixTimeSeconds();

        if (!current && abortInvalid)
            await RevokeAsync(context, cancellationToken);
        return current;
    }

    public async Task RevalidateConnectionsAsync(CancellationToken cancellationToken = default)
    {
        // Check sockets concurrently so one slow lookup does not postpone every later socket's
        // check. Redis failure is a revoked result in the shared validator, never a keep-alive.
        await Task.WhenAll(_connections.Values.Select(context => ValidateAsync(context, cancellationToken)));
    }

    private async Task RevokeAsync(HubCallerContext context, CancellationToken cancellationToken)
    {
        Unregister(context.ConnectionId);
        context.Abort();
        var tasks = Array.Empty<string>();
        if (context.Items.TryGetValue(NotificationHub.JoinedTasksKey, out var raw) &&
            raw is ConcurrentDictionary<string, byte> joined)
        {
            tasks = joined.Keys.ToArray();
            joined.Clear();
        }

        var userId = context.UserIdentifier;
        if (string.IsNullOrEmpty(userId))
            return;
        await connectionManager.RemoveConnectionAsync(userId, context.ConnectionId);
        try
        {
            // Abort also lets SignalR remove every group (including topics). Remove the addressed
            // user/branch groups now so in-flight producers stop routing to the invalid socket.
            await hubContext.Groups.RemoveFromGroupAsync(context.ConnectionId, $"user:{userId}", cancellationToken);
            if (Guid.TryParse(userId, out var userGuid))
                foreach (var task in tasks)
                    if (Guid.TryParse(task, out var taskGuid))
                        await hubContext.Groups.RemoveFromGroupAsync(context.ConnectionId,
                            NotificationHub.UserBranchGroup(taskGuid, userGuid), cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // A failing Redis backplane must not keep an invalid socket alive or registered.
            logger.LogWarning(ex, "Could not remove groups for aborted realtime connection {ConnectionId}", context.ConnectionId);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(RevalidationInterval, timeProvider);
        while (await timer.WaitForNextTickAsync(stoppingToken))
            await RevalidateConnectionsAsync(stoppingToken);
    }
}

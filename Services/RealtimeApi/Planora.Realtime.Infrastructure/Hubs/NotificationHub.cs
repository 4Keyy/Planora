using System.Collections.Concurrent;
using System.Security.Claims;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Infrastructure.Services;
using Microsoft.AspNetCore.Authorization;

namespace Planora.Realtime.Infrastructure.Hubs
{
    /// <summary>
    /// The single SignalR hub every client connects to. It carries three independent streams over
    /// one connection:
    ///   • <b>Notifications</b> — per-user toasts (<c>ReceiveNotification</c>), delivered to the
    ///     <c>user:{id}</c> group joined automatically on connect.
    ///   • <b>Live data sync</b> — <c>TaskFeedChanged</c> (lists/dashboard) and <c>BranchChanged</c>
    ///     (open branch rooms), pushed by <see cref="RealtimeBroadcaster"/> in response to
    ///     integration events. The client refetches the affected slice to reconcile.
    ///   • <b>Presence / typing</b> — ephemeral <c>UserTyping</c> / <c>UserStoppedTyping</c> signals
    ///     scoped to a branch room, never persisted.
    ///
    /// Branch rooms (<c>task:{id}</c>) are authorization-gated: a client must pass
    /// <see cref="ITaskBranchAuthorizer"/> (TodoApi's ownership/sharing check) before it is added
    /// to a room, and typing signals are only relayed to rooms the caller has actually joined.
    /// </summary>
    [Authorize]
    public sealed class NotificationHub : Hub
    {
        private const string JoinedTasksKey = "joined-tasks";

        private readonly ILogger<NotificationHub> _logger;
        private readonly IConnectionManager _connectionManager;
        private readonly ITaskBranchAuthorizer _branchAuthorizer;

        public NotificationHub(
            ILogger<NotificationHub> logger,
            IConnectionManager connectionManager,
            ITaskBranchAuthorizer branchAuthorizer)
        {
            _logger = logger;
            _connectionManager = connectionManager;
            _branchAuthorizer = branchAuthorizer;
        }

        public override async Task OnConnectedAsync()
        {
            var userId = Context.UserIdentifier;

            if (!string.IsNullOrEmpty(userId))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"user:{userId}");
                await _connectionManager.AddConnectionAsync(userId, Context.ConnectionId);

                _logger.LogInformation(
                    "✅ User {UserId} connected to SignalR (ConnectionId: {ConnectionId})",
                    userId,
                    Context.ConnectionId);
            }

            await base.OnConnectedAsync();
        }

        public override async Task OnDisconnectedAsync(Exception? exception)
        {
            var userId = Context.UserIdentifier;

            if (!string.IsNullOrEmpty(userId))
            {
                await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"user:{userId}");
                await _connectionManager.RemoveConnectionAsync(userId, Context.ConnectionId);

                // Tell every branch this connection was viewing that the user stopped typing, so a
                // hard disconnect mid-keystroke never leaves a stale "… печатает" indicator behind.
                if (Context.Items.TryGetValue(JoinedTasksKey, out var raw) && raw is ConcurrentDictionary<string, byte> joined)
                {
                    foreach (var taskId in joined.Keys)
                    {
                        await Clients.OthersInGroup($"task:{taskId}")
                            .SendAsync("UserStoppedTyping", new { taskId, userId });
                    }
                }

                _logger.LogInformation(
                    "👋 User {UserId} disconnected from SignalR (ConnectionId: {ConnectionId})",
                    userId,
                    Context.ConnectionId);
            }

            await base.OnDisconnectedAsync(exception);
        }

        // ── Broadcast topics (notifications) ─────────────────────────────────────────
        // The "user:" namespace is reserved for per-user delivery and is managed exclusively by
        // OnConnected/OnDisconnected using the caller's own verified id — never client-controllable.
        private static readonly IReadOnlySet<string> AllowedTopics =
            new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "system",
                "announcements",
                "todos",
            };

        public async Task Subscribe(string notificationType)
        {
            if (!AllowedTopics.Contains(notificationType))
            {
                _logger.LogWarning(
                    "User {UserId} attempted to subscribe to disallowed topic {Topic}",
                    Context.UserIdentifier,
                    notificationType);
                return;
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, notificationType);
            _logger.LogInformation("User subscribed to {NotificationType}", notificationType);
        }

        public async Task Unsubscribe(string notificationType)
        {
            if (!AllowedTopics.Contains(notificationType))
                return;

            await Groups.RemoveFromGroupAsync(Context.ConnectionId, notificationType);
            _logger.LogInformation("User unsubscribed from {NotificationType}", notificationType);
        }

        // ── Branch rooms (live collaboration on a task's "ветка") ─────────────────────

        /// <summary>
        /// Joins the caller to a task's branch room so they receive <c>BranchChanged</c> and typing
        /// signals for it. Authorized against TodoApi's ownership/sharing rules — an unauthorized or
        /// malformed id is silently ignored (fail closed), so a client cannot eavesdrop on a branch
        /// it may not read.
        /// </summary>
        public async Task JoinTask(string taskId)
        {
            var userId = Context.UserIdentifier;
            if (string.IsNullOrEmpty(userId) || !Guid.TryParse(taskId, out var taskGuid) || !Guid.TryParse(userId, out var userGuid))
                return;

            if (!await _branchAuthorizer.CanAccessBranchAsync(taskGuid, userGuid, Context.ConnectionAborted))
            {
                _logger.LogWarning("User {UserId} denied branch join for task {TaskId}", userId, taskId);
                return;
            }

            await Groups.AddToGroupAsync(Context.ConnectionId, $"task:{taskGuid}");
            JoinedTasks.TryAdd(taskGuid.ToString(), 0);
            _logger.LogDebug("User {UserId} joined branch room task:{TaskId}", userId, taskGuid);
        }

        /// <summary>Leaves a branch room (called when a branch view closes). Always clears typing.</summary>
        public async Task LeaveTask(string taskId)
        {
            if (!Guid.TryParse(taskId, out var taskGuid))
                return;

            var key = taskGuid.ToString();
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, $"task:{taskGuid}");
            JoinedTasks.TryRemove(key, out _);

            await Clients.OthersInGroup($"task:{taskGuid}")
                .SendAsync("UserStoppedTyping", new { taskId = key, userId = Context.UserIdentifier });
        }

        /// <summary>
        /// Relays a "{name} is typing" signal to everyone else in the branch room. Ephemeral —
        /// never stored. Only honored for rooms the caller has actually joined, so a client cannot
        /// inject typing noise into branches it is not part of.
        /// </summary>
        public async Task StartTyping(string taskId)
        {
            if (!Guid.TryParse(taskId, out var taskGuid) || !JoinedTasks.ContainsKey(taskGuid.ToString()))
                return;

            await Clients.OthersInGroup($"task:{taskGuid}").SendAsync("UserTyping", new
            {
                taskId = taskGuid.ToString(),
                userId = Context.UserIdentifier,
                name = ResolveDisplayName(),
            });
        }

        /// <summary>Clears the caller's typing indicator in a branch room (on send, blur, or idle timeout).</summary>
        public async Task StopTyping(string taskId)
        {
            if (!Guid.TryParse(taskId, out var taskGuid) || !JoinedTasks.ContainsKey(taskGuid.ToString()))
                return;

            await Clients.OthersInGroup($"task:{taskGuid}").SendAsync("UserStoppedTyping", new
            {
                taskId = taskGuid.ToString(),
                userId = Context.UserIdentifier,
            });
        }

        /// <summary>Per-connection set of branch rooms this connection has joined (for typing authz).</summary>
        private ConcurrentDictionary<string, byte> JoinedTasks
        {
            get
            {
                if (Context.Items.TryGetValue(JoinedTasksKey, out var raw) && raw is ConcurrentDictionary<string, byte> existing)
                    return existing;

                var created = new ConcurrentDictionary<string, byte>();
                Context.Items[JoinedTasksKey] = created;
                return created;
            }
        }

        /// <summary>Builds "Имя Фамилия" from the JWT, mirroring CurrentUserContext.Name.</summary>
        private string ResolveDisplayName()
        {
            var user = Context.User;
            if (user is null)
                return "Someone";

            var first = user.FindFirst("firstName")?.Value;
            var last = user.FindFirst("lastName")?.Value;
            var full = $"{first} {last}".Trim();
            if (!string.IsNullOrWhiteSpace(full))
                return full;

            return user.FindFirst("name")?.Value
                ?? user.FindFirst("given_name")?.Value
                ?? user.FindFirst(ClaimTypes.Email)?.Value
                ?? "Someone";
        }
    }
}

using Microsoft.AspNetCore.Authorization;

namespace Planora.Realtime.Infrastructure.Hubs
{
    [Authorize]
    public sealed class TodoHub : Hub
    {
        private readonly ILogger<TodoHub> _logger;

        public TodoHub(ILogger<TodoHub> logger)
        {
            _logger = logger;
        }

        public override async Task OnConnectedAsync()
        {
            var userId = Context.UserIdentifier;
            if (!string.IsNullOrEmpty(userId))
            {
                await Groups.AddToGroupAsync(Context.ConnectionId, $"todos:{userId}");
                _logger.LogInformation("📝 User {UserId} connected to TodoHub", userId);
            }
            await base.OnConnectedAsync();
        }

        public async Task NotifyTodoCreated(string userId, object todo)
        {
            await Clients.Group($"todos:{userId}").SendAsync("TodoCreated", todo);
        }

        public async Task NotifyTodoUpdated(string userId, object todo)
        {
            await Clients.Group($"todos:{userId}").SendAsync("TodoUpdated", todo);
        }

        public async Task NotifyTodoDeleted(string userId, Guid todoId)
        {
            await Clients.Group($"todos:{userId}").SendAsync("TodoDeleted", todoId);
        }
    }
}

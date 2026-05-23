using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.IntegrationEvents
{
    /// <summary>
    /// When a friendship is revoked, removes all TodoItemShare rows between the two users
    /// so neither can access the other's previously-shared todos.
    /// </summary>
    public sealed class FriendshipRemovedEventConsumer : IIntegrationEventHandler<FriendshipRemovedIntegrationEvent>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly ILogger<FriendshipRemovedEventConsumer> _logger;

        public FriendshipRemovedEventConsumer(
            ITodoRepository todoRepository,
            ILogger<FriendshipRemovedEventConsumer> logger)
        {
            _todoRepository = todoRepository;
            _logger = logger;
        }

        public async Task HandleAsync(FriendshipRemovedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            try
            {
                await _todoRepository.RemoveSharesBetweenUsersAsync(
                    @event.UserId,
                    @event.FriendId,
                    cancellationToken);

                _logger.LogInformation(
                    "Removed todo shares between users {UserId} and {FriendId} after friendship revocation",
                    @event.UserId,
                    @event.FriendId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to remove todo shares between {UserId} and {FriendId}",
                    @event.UserId,
                    @event.FriendId);
                throw;
            }
        }
    }
}

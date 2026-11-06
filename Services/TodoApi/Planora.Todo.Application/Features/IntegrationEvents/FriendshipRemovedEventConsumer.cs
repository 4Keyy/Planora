using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Revokes the pair's shares and worker slots in one commit with content-free sync signals.
    /// </summary>
    public sealed class FriendshipRemovedEventConsumer : IIntegrationEventHandler<FriendshipRemovedIntegrationEvent>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IOutboxRepository _outboxRepository;
        private readonly IFriendshipService _friendshipService;
        private readonly ILogger<FriendshipRemovedEventConsumer> _logger;

        public FriendshipRemovedEventConsumer(
            ITodoRepository todoRepository,
            IUnitOfWork unitOfWork,
            IOutboxRepository outboxRepository,
            IFriendshipService friendshipService,
            ILogger<FriendshipRemovedEventConsumer> logger)
        {
            _todoRepository = todoRepository;
            _unitOfWork = unitOfWork;
            _outboxRepository = outboxRepository;
            _friendshipService = friendshipService;
            _logger = logger;
        }

        public async Task HandleAsync(FriendshipRemovedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            try
            {
                var todos = await _todoRepository.StageRevokeFriendshipAccessAsync(
                    @event.UserId,
                    @event.FriendId,
                    cancellationToken);

                // Only legacy public roots need the dynamic feed audience. Resolve each owner once.
                var legacyAudiences = new Dictionary<Guid, IReadOnlyList<Guid>>();
                foreach (var todo in todos)
                {
                    IReadOnlyList<Guid> audience = Array.Empty<Guid>();
                    if (!todo.IsSubtask)
                    {
                        var recipients = todo.SharedWith.Select(share => share.SharedWithUserId)
                            .Append(todo.UserId)
                            .Append(todo.UserId == @event.UserId ? @event.FriendId : @event.UserId);
                        if (todo.IsPublic && todo.AllFriendsSnapshotAt == null)
                        {
                            if (!legacyAudiences.TryGetValue(todo.UserId, out var friends))
                            {
                                friends = await RealtimeAudience.SafeGetFriendIdsAsync(
                                    _friendshipService, todo.UserId, cancellationToken, _logger);
                                legacyAudiences.Add(todo.UserId, friends);
                            }
                            recipients = recipients.Concat(friends);
                        }
                        audience = recipients.Where(id => id != Guid.Empty).Distinct().ToArray();
                    }

                    await _outboxRepository.StageIntegrationEventAsync(
                        new RealtimeSyncIntegrationEvent(
                            todo.IsSubtask ? RealtimeSyncAction.SubtaskChanged : RealtimeSyncAction.TaskUpdated,
                            todo.Id, Guid.Empty, branchTaskId: todo.ParentTodoId ?? todo.Id,
                            audienceUserIds: audience), cancellationToken);
                }

                if (todos.Count > 0)
                    await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Revoked access on {Count} todos between users {UserId} and {FriendId}",
                    todos.Count,
                    @event.UserId,
                    @event.FriendId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to revoke todo access between {UserId} and {FriendId}",
                    @event.UserId,
                    @event.FriendId);
                throw;
            }
        }
    }
}

using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Soft-deletes all todos owned by a user when that user is permanently deleted in AuthApi.
    /// Prevents orphaned todos from accumulating in the database after account deletion.
    /// </summary>
    public sealed class UserDeletedEventConsumer : IIntegrationEventHandler<UserDeletedIntegrationEvent>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<UserDeletedEventConsumer> _logger;

        public UserDeletedEventConsumer(
            ITodoRepository todoRepository,
            IUnitOfWork unitOfWork,
            ILogger<UserDeletedEventConsumer> logger)
        {
            _todoRepository = todoRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(UserDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            try
            {
                var todos = await _todoRepository.GetByUserIdAsync(@event.UserId, cancellationToken);

                if (todos.Count == 0)
                {
                    _logger.LogInformation(
                        "No todos found for deleted user {UserId} — nothing to clean up",
                        @event.UserId);
                    return;
                }

                foreach (var todo in todos)
                {
                    todo.MarkAsDeleted(@event.UserId);
                    _todoRepository.Update(todo);
                }

                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Soft-deleted {Count} todos for deleted user {UserId}",
                    todos.Count,
                    @event.UserId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to soft-delete todos for deleted user {UserId}",
                    @event.UserId);
                throw;
            }
        }
    }
}

using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
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
                // Tracked soft-delete so the xmin concurrency token is captured; the previous
                // AsNoTracking load + Update issued `WHERE xmin = 0` and silently cleaned up nothing.
                var affected = await _todoRepository.SoftDeleteByUserIdAsync(
                    @event.UserId, @event.UserId, cancellationToken);

                if (affected == 0)
                {
                    _logger.LogInformation(
                        "No todos found for deleted user {UserId} — nothing to clean up",
                        @event.UserId);
                    return;
                }

                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Soft-deleted {Count} todos for deleted user {UserId}",
                    affected,
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

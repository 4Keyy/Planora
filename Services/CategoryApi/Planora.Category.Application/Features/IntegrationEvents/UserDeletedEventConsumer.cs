using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Category.Domain.Repositories;

namespace Planora.Category.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Soft-deletes all categories owned by a user when that user is permanently deleted in AuthApi.
    /// Prevents orphaned categories from accumulating in the database after account deletion.
    /// </summary>
    public sealed class UserDeletedEventConsumer : IIntegrationEventHandler<UserDeletedIntegrationEvent>
    {
        private readonly ICategoryRepository _categoryRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<UserDeletedEventConsumer> _logger;

        public UserDeletedEventConsumer(
            ICategoryRepository categoryRepository,
            IUnitOfWork unitOfWork,
            ILogger<UserDeletedEventConsumer> logger)
        {
            _categoryRepository = categoryRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(UserDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            try
            {
                // Tracked soft-delete so the xmin concurrency token is captured; the previous
                // AsNoTracking load + Update issued `WHERE xmin = 0` and silently cleaned up nothing.
                // (The repository calls MarkAsDeleted directly — Category.Delete() enforces
                // UserId == deletedBy, which would throw for a system-level cleanup.)
                var affected = await _categoryRepository.SoftDeleteByUserIdAsync(
                    @event.UserId, @event.UserId, cancellationToken);

                if (affected == 0)
                {
                    _logger.LogInformation(
                        "No categories found for deleted user {UserId} — nothing to clean up",
                        @event.UserId);
                    return;
                }

                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Soft-deleted {Count} categories for deleted user {UserId}",
                    affected,
                    @event.UserId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to soft-delete categories for deleted user {UserId}",
                    @event.UserId);
                throw;
            }
        }
    }
}

using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
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
                var categories = await _categoryRepository.GetByUserIdAsync(@event.UserId, cancellationToken);

                if (categories.Count == 0)
                {
                    _logger.LogInformation(
                        "No categories found for deleted user {UserId} — nothing to clean up",
                        @event.UserId);
                    return;
                }

                foreach (var category in categories)
                {
                    // Call MarkAsDeleted directly — Category.Delete() enforces ownership via
                    // UserId == deletedBy, which would throw for a system-level cleanup operation.
                    category.MarkAsDeleted(@event.UserId);
                    _categoryRepository.Update(category);
                }

                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Soft-deleted {Count} categories for deleted user {UserId}",
                    categories.Count,
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

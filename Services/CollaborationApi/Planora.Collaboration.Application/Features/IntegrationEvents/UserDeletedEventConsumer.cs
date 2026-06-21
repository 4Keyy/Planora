using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.IntegrationEvents
{
    /// <summary>
    /// Soft-deletes every comment authored by a user when that user is permanently deleted in
    /// AuthApi, mirroring TodoApi's UserDeleted cleanup. Prevents orphaned authored content from
    /// lingering in timelines after account deletion. Idempotent — already-deleted rows are
    /// filtered out by the repository's soft-delete query filter.
    /// </summary>
    public sealed class UserDeletedEventConsumer : IIntegrationEventHandler<UserDeletedIntegrationEvent>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<UserDeletedEventConsumer> _logger;

        public UserDeletedEventConsumer(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ILogger<UserDeletedEventConsumer> logger)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(UserDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            // Delegate to the tracked-load soft-delete so the xmin concurrency token is captured;
            // the previous AsNoTracking FindAsync + Update issued `WHERE xmin = 0` and the cleanup
            // failed with a spurious DbUpdateConcurrencyException, so deleted users' comments were
            // never actually removed.
            var affected = await _commentRepository.SoftDeleteByAuthorAsync(
                @event.UserId, @event.UserId, cancellationToken);

            if (affected == 0)
            {
                _logger.LogInformation(
                    "No comments authored by deleted user {UserId} — nothing to clean up",
                    @event.UserId);
                return;
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Soft-deleted {Count} comments authored by deleted user {UserId}",
                affected, @event.UserId);
        }
    }
}

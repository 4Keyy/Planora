using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;

namespace Planora.Auth.Application.Features.Users.Handlers.DeleteUser
{
    public sealed class DeleteUserCommandHandler : IRequestHandler<DeleteUserCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly ICurrentUserService _currentUserService;
        private readonly IEventBus _eventBus;
        private readonly ISecurityStampService _securityStamp;
        private readonly IAvatarStorage _avatarStorage;
        private readonly ILogger<DeleteUserCommandHandler> _logger;

        public DeleteUserCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ICurrentUserService currentUserService,
            IEventBus eventBus,
            ISecurityStampService securityStamp,
            IAvatarStorage avatarStorage,
            ILogger<DeleteUserCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _currentUserService = currentUserService;
            _eventBus = eventBus;
            _securityStamp = securityStamp;
            _avatarStorage = avatarStorage;
            _logger = logger;
        }

        public async Task<Result> Handle(
            DeleteUserCommand command,
            CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
            {
                return Result.Failure(
                    Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
            }

            var user = await _unitOfWork.Users.GetByIdAsync(_currentUserService.UserId.Value, cancellationToken);

            if (user == null)
            {
                return Result.Failure(
                    Error.NotFound("USER_NOT_FOUND", "User not found"));
            }

            if (!_passwordHasher.VerifyPassword(command.Password, user.PasswordHash))
            {
                _logger.LogWarning("Invalid password during account deletion attempt: {UserId}", user.Id);
                return Result.Failure(
                    Error.Unauthorized("INVALID_PASSWORD", "Password is incorrect"));
            }

            user.MarkAsDeleted(user.Id);
            user.Deactivate(user.Id);

            _unitOfWork.Users.Update(user);

            // Persist the soft-delete BEFORE publishing the integration event so that
            // if the publish fails the deletion can be retried without losing data.
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // SECURITY: rotate the security stamp on soft-delete so that any access
            // token issued before the deletion is immediately rejected. Without
            // this, a deleted user's outstanding token could still hit endpoints
            // until it expired naturally — and any handler that did not separately
            // check IsDeleted would treat the request as authentic.
            await _securityStamp.SetStampAsync(user.Id, cancellationToken);

            // PRIVACY: the photo goes with the account. Avatars are public static files
            // (/avatars/{userId}/…), and nothing ever called DeleteAsync: a deleted person's
            // face stayed reachable by URL for good. Best-effort — a filesystem hiccup must not
            // undo a completed deletion, and the deleted-account purge sweeps the tree again.
            try
            {
                await _avatarStorage.DeleteAsync(user.Id, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not delete the avatar of deleted user {UserId}; the retention purge retries", user.Id);
            }

            // Publish cross-service integration event so TodoApi, CategoryApi, CollaborationApi
            // and RealtimeApi clean up the data they hold for this user.
            var integrationEvent = new UserDeletedIntegrationEvent(user.Id, user.Email.Value);
            await _eventBus.PublishAsync(integrationEvent, cancellationToken);

            _logger.LogInformation("User account deleted: {UserId}, Email: {Email}", user.Id, user.Email.Value);
            return Result.Success();
        }
    }
}

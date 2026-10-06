using Planora.Auth.Application.Features.Users.Commands.DeleteUser;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using System.Text.Json;

namespace Planora.Auth.Application.Features.Users.Handlers.DeleteUser
{
    public sealed class DeleteUserCommandHandler : IRequestHandler<DeleteUserCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly ICurrentUserService _currentUserService;
        private readonly IOutboxRepository _outbox;
        private readonly ISecurityStampService _securityStamp;
        private readonly IAvatarStorage _avatarStorage;
        private readonly ILogger<DeleteUserCommandHandler> _logger;

        public DeleteUserCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ICurrentUserService currentUserService,
            IOutboxRepository outbox,
            ISecurityStampService securityStamp,
            IAvatarStorage avatarStorage,
            ILogger<DeleteUserCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _currentUserService = currentUserService;
            _outbox = outbox;
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

            // The canonical outbox shares this unit of work's context: AddAsync commits
            // the tracked deletion and its cleanup event together. A Redis or broker outage
            // after this commit must not leave other services with an unrepeatable deletion.
            var integrationEvent = new UserDeletedIntegrationEvent(user.Id, user.Email.Value);
            await _outbox.AddAsync(new OutboxMessage(
                typeof(UserDeletedIntegrationEvent).AssemblyQualifiedName!,
                JsonSerializer.Serialize(integrationEvent),
                DateTime.UtcNow), cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            // SECURITY: rotate the security stamp on soft-delete so that any access
            // token issued before the deletion is immediately rejected. Without
            // this, a deleted user's outstanding token could still hit endpoints
            // until it expired naturally — and any handler that did not separately
            // check IsDeleted would treat the request as authentic.
            try
            {
                await _securityStamp.SetStampAsync(user.Id, cancellationToken);
            }
            finally
            {
                // PRIVACY: even a security-stamp outage must not skip deleting the public
                // avatar. Filesystem failures remain best-effort and are retried by retention;
                // a stamp failure itself still propagates rather than reporting success.
                try
                {
                    await _avatarStorage.DeleteAsync(user.Id, cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Could not delete the avatar of deleted user {UserId}; the retention purge retries", user.Id);
                }
            }

            _logger.LogInformation("User account deleted: {UserId}, Email: {Email}", user.Id, user.Email.Value);
            return Result.Success();
        }
    }
}

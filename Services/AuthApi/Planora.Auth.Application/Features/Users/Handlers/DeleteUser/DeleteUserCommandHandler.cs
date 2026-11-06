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

            var verifiedPasswordHash = user.PasswordHash;
            if (!_passwordHasher.VerifyPassword(command.Password, verifiedPasswordHash))
            {
                _logger.LogWarning("Invalid password during account deletion attempt: {UserId}", user.Id);
                return Result.Failure(
                    Error.Unauthorized("INVALID_PASSWORD", "Password is incorrect"));
            }

            var deleted = await _unitOfWork.TryDeleteUserAsync(
                user.Id, verifiedPasswordHash,
                async (owner, token) =>
                {
                    // Stage from the locked owner on every attempt: the same SQL commit owns deletion and cleanup.
                    var integrationEvent = new UserDeletedIntegrationEvent(owner.Id, owner.Email.Value);
                    await _outbox.StageAsync(new OutboxMessage(
                        typeof(UserDeletedIntegrationEvent).AssemblyQualifiedName!,
                        JsonSerializer.Serialize(integrationEvent), DateTime.UtcNow), token);
                },
                token => _securityStamp.SetStampAsync(user.Id, token), cancellationToken);
            if (deleted is null)
                return Result.Failure(Error.Unauthorized("INVALID_PASSWORD", "Password is incorrect"));

            try
            {
                // Deletion already committed. Cleanup has its own bounded token, independent of the request.
                using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(10));
                await _avatarStorage.DeleteAsync(user.Id, cleanup.Token);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Could not delete the avatar of deleted user {UserId}; the retention purge retries", user.Id);
            }

            _logger.LogInformation("User account deleted: {UserId}, Email: {Email}", user.Id, user.Email.Value);
            return Result.Success();
        }
    }
}

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
        private readonly ILogger<DeleteUserCommandHandler> _logger;

        public DeleteUserCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ICurrentUserService currentUserService,
            IEventBus eventBus,
            ISecurityStampService securityStamp,
            ILogger<DeleteUserCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _currentUserService = currentUserService;
            _eventBus = eventBus;
            _securityStamp = securityStamp;
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

            // Publish cross-service integration event so TodoApi, CategoryApi, and
            // MessagingApi can clean up data owned by this user.
            var integrationEvent = new UserDeletedIntegrationEvent(user.Id, user.Email.Value);
            await _eventBus.PublishAsync(integrationEvent, cancellationToken);

            _logger.LogInformation("User account deleted: {UserId}, Email: {Email}", user.Id, user.Email.Value);
            return Result.Success();
        }
    }
}

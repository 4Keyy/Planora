using Planora.Auth.Application.Features.Users.Commands.RevokeAllSessions;

namespace Planora.Auth.Application.Features.Users.Handlers.RevokeSessions
{
    public sealed class RevokeAllSessionsCommandHandler : IRequestHandler<RevokeAllSessionsCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<RevokeAllSessionsCommandHandler> _logger;

        public RevokeAllSessionsCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ICurrentUserService currentUserService,
            ILogger<RevokeAllSessionsCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result> Handle(
            RevokeAllSessionsCommand command,
            CancellationToken cancellationToken)
        {
            try
            {
                if (!_currentUserService.UserId.HasValue)
                {
                    return Result.Failure(
                        Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
                }

                var user = await _unitOfWork.Users.GetByIdAsync(
                    _currentUserService.UserId.Value,
                    cancellationToken);

                if (user == null)
                {
                    return Result.Failure(
                        Error.NotFound("USER_NOT_FOUND", "User not found"));
                }

                if (!_passwordHasher.VerifyPassword(command.Password, user.PasswordHash))
                {
                    _logger.LogWarning(
                        "Invalid password during session revocation: {UserId}",
                        user.Id);
                    return Result.Failure(
                        Error.Unauthorized("INVALID_PASSWORD", "Password is incorrect"));
                }

                var ipAddress = _currentUserService.IpAddress ?? "unknown";
                user.RevokeAllRefreshTokens(ipAddress);

                _unitOfWork.Users.Update(user);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation("All sessions revoked for user: {UserId}", user.Id);
                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error revoking all sessions");
                return Result.Failure(
                    Error.InternalServer("REVOKE_ALL_ERROR", "An error occurred while revoking all sessions"));
            }
        }
    }
}

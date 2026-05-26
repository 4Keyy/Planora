using Planora.Auth.Application.Features.Users.Commands.Disable2FA;

namespace Planora.Auth.Application.Features.Users.Handlers.Disable2FA
{
    public sealed class Disable2FACommandHandler : IRequestHandler<Disable2FACommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly ICurrentUserService _currentUserService;
        private readonly ISecurityStampService _securityStamp;
        private readonly ILogger<Disable2FACommandHandler> _logger;

        public Disable2FACommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ICurrentUserService currentUserService,
            ISecurityStampService securityStamp,
            ILogger<Disable2FACommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _currentUserService = currentUserService;
            _securityStamp = securityStamp;
            _logger = logger;
        }

        public async Task<Result> Handle(
            Disable2FACommand command,
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
                    _logger.LogWarning("Invalid password during 2FA disable: {UserId}", user.Id);
                    return Result.Failure(
                        Error.Unauthorized("INVALID_PASSWORD", "Password is incorrect"));
                }

                if (!user.TwoFactorEnabled)
                {
                    return Result.Failure(
                        Error.Conflict("2FA_NOT_ENABLED", "Two-factor authentication is not enabled"));
                }

                user.DisableTwoFactor();

                _unitOfWork.Users.Update(user);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                // SECURITY: disabling 2FA reduces the account's security posture.
                // Rotate the security stamp so every existing access token is rejected
                // on its next authenticated request — the user re-authenticates on
                // every device, eliminating the window where a stolen access token
                // could continue to operate against a now-weaker account.
                await _securityStamp.SetStampAsync(user.Id, cancellationToken);

                _logger.LogInformation("2FA disabled for user: {UserId}", user.Id);
                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error disabling 2FA");
                return Result.Failure(
                    Error.InternalServer("DISABLE_2FA_ERROR", "An error occurred while disabling 2FA"));
            }
        }
    }
}

using Planora.Auth.Application.Features.Users.Commands.Confirm2FA;

namespace Planora.Auth.Application.Features.Users.Handlers.Confirm2FA
{
    public sealed class Confirm2FACommandHandler : IRequestHandler<Confirm2FACommand, Result<IReadOnlyList<string>>>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ITwoFactorService _twoFactorService;
        private readonly ICurrentUserService _currentUserService;
        private readonly IRecoveryCodeService _recoveryCodeService;
        private readonly ILogger<Confirm2FACommandHandler> _logger;

        public Confirm2FACommandHandler(
            IAuthUnitOfWork unitOfWork,
            ITwoFactorService twoFactorService,
            ICurrentUserService currentUserService,
            IRecoveryCodeService recoveryCodeService,
            ILogger<Confirm2FACommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _twoFactorService = twoFactorService;
            _currentUserService = currentUserService;
            _recoveryCodeService = recoveryCodeService;
            _logger = logger;
        }

        public async Task<Result<IReadOnlyList<string>>> Handle(
            Confirm2FACommand command,
            CancellationToken cancellationToken)
        {
            try
            {
                if (!_currentUserService.UserId.HasValue)
                {
                    return Result.Failure<IReadOnlyList<string>>(
                        Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
                }

                var user = await _unitOfWork.Users.GetByIdAsync(
                    _currentUserService.UserId.Value,
                    cancellationToken);

                if (user == null)
                {
                    return Result.Failure<IReadOnlyList<string>>(
                        Error.NotFound("USER_NOT_FOUND", "User not found"));
                }

                if (!user.TwoFactorEnabled || string.IsNullOrEmpty(user.TwoFactorSecret))
                {
                    return Result.Failure<IReadOnlyList<string>>(
                        Error.Conflict("2FA_NOT_SETUP", "Two-factor authentication is not set up"));
                }

                if (!await _twoFactorService.VerifyCodeAsync(user.TwoFactorSecret, command.Code, user.Id, cancellationToken))
                {
                    _logger.LogWarning("Invalid 2FA code during confirmation: {UserId}", user.Id);
                    return Result.Failure<IReadOnlyList<string>>(
                        Error.Unauthorized("INVALID_2FA_CODE", "Invalid two-factor authentication code"));
                }

                var recoveryCodes = await _recoveryCodeService.GenerateAndStoreCodesAsync(
                    user.Id,
                    cancellationToken);

                _logger.LogInformation("2FA confirmed and recovery codes generated for user: {UserId}", user.Id);
                return Result.Success(recoveryCodes);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error confirming 2FA");
                return Result.Failure<IReadOnlyList<string>>(
                    Error.InternalServer("CONFIRM_2FA_ERROR", "An error occurred while confirming 2FA"));
            }
        }
    }
}

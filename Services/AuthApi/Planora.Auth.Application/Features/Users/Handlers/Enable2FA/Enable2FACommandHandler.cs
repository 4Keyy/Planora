using Planora.Auth.Application.Features.Users.Commands.Enable2FA;

namespace Planora.Auth.Application.Features.Users.Handlers.Enable2FA
{
    public sealed class Enable2FACommandHandler : IRequestHandler<Enable2FACommand, Result<Enable2FAResponse>>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ITwoFactorService _twoFactorService;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<Enable2FACommandHandler> _logger;

        public Enable2FACommandHandler(
            IAuthUnitOfWork unitOfWork,
            ITwoFactorService twoFactorService,
            ICurrentUserService currentUserService,
            ILogger<Enable2FACommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _twoFactorService = twoFactorService;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result<Enable2FAResponse>> Handle(
            Enable2FACommand command,
            CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
            {
                return Result.Failure<Enable2FAResponse>(
                    Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
            }

            var user = await _unitOfWork.Users.GetByIdAsync(
                _currentUserService.UserId.Value,
                cancellationToken);

            if (user == null)
            {
                return Result.Failure<Enable2FAResponse>(
                    Error.NotFound("USER_NOT_FOUND", "User not found"));
            }

            if (user.IsTwoFactorEnabled)
            {
                return Result.Failure<Enable2FAResponse>(
                    Error.Conflict("2FA_ALREADY_ENABLED", "Two-factor authentication is already enabled"));
            }

            var secret = _twoFactorService.GenerateSecret();
            var qrCodeUrl = _twoFactorService.GenerateQrCodeUrl(user.Email.Value, secret);

            // Enrolment only stores the secret (pending). 2FA does not become active — and the login
            // gate does not start requiring a code — until Confirm2FA verifies the first TOTP. This
            // closes the self-lockout window where a user who scanned the QR but never confirmed
            // could be asked for a code they had no way to produce.
            user.BeginTwoFactorSetup(secret);

            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("2FA enrolment started (pending confirmation) for user: {UserId}", user.Id);

            var response = new Enable2FAResponse
            {
                Secret = secret,
                QrCodeUrl = qrCodeUrl
            };

            return Result.Success(response);
        }
    }
}

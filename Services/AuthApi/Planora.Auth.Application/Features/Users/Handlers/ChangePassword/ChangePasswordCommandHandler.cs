using Planora.Auth.Application.Features.Users.Commands.ChangePassword;

namespace Planora.Auth.Application.Features.Users.Handlers.ChangePassword
{
    public sealed class ChangePasswordCommandHandler : IRequestHandler<ChangePasswordCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly IPasswordValidator _passwordValidator;
        private readonly ICurrentUserService _currentUserService;
        private readonly IEmailService _emailService;
        private readonly ILogger<ChangePasswordCommandHandler> _logger;

        public ChangePasswordCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            IPasswordValidator passwordValidator,
            ICurrentUserService currentUserService,
            IEmailService emailService,
            ILogger<ChangePasswordCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _passwordValidator = passwordValidator;
            _currentUserService = currentUserService;
            _emailService = emailService;
            _logger = logger;
        }

        public async Task<Result> Handle(
            ChangePasswordCommand command,
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

            if (!_passwordHasher.VerifyPassword(command.CurrentPassword, user.PasswordHash))
            {
                _logger.LogWarning("Invalid current password for user: {UserId}", user.Id);
                return Result.Failure(
                    Error.Unauthorized("INVALID_PASSWORD", "Current password is incorrect"));
            }

            if (!_passwordValidator.IsStrongPassword(command.NewPassword))
            {
                return Result.Failure(
                    Error.Validation(
                        "WEAK_PASSWORD",
                        "Password does not meet security requirements",
                        new Dictionary<string, string[]>
                        {
                            ["NewPassword"] = new[] { "Password must be at least 8 characters and contain uppercase, lowercase, digit and special character" }
                        }));
            }

            var isCompromised = await _passwordValidator.IsPasswordCompromisedAsync(
                command.NewPassword,
                cancellationToken);

            if (isCompromised)
            {
                _logger.LogWarning("Attempt to use compromised password: {UserId}", user.Id);
                return Result.Failure(
                    Error.Validation(
                        "COMPROMISED_PASSWORD",
                        "This password has been compromised in a data breach",
                        new Dictionary<string, string[]>
                        {
                            ["NewPassword"] = new[] { "Please choose a different password" }
                        }));
            }

            var isDifferent = await _passwordValidator.IsDifferentFromPreviousPasswordsAsync(
                user.Id,
                command.NewPassword,
                5,
                cancellationToken);

            if (!isDifferent)
            {
                return Result.Failure(
                    Error.Validation(
                        "PASSWORD_REUSED",
                        "You cannot reuse any of your last 5 passwords",
                        new Dictionary<string, string[]>
                        {
                            ["NewPassword"] = new[] { "Please choose a different password" }
                        }));
            }

            var passwordHistory = new PasswordHistory(user.Id, user.PasswordHash);
            await _unitOfWork.PasswordHistory.AddAsync(passwordHistory, cancellationToken);

            var newPasswordHash = _passwordHasher.HashPassword(command.NewPassword);
            user.ChangePassword(newPasswordHash, user.Id);

            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            await _unitOfWork.PasswordHistory.DeleteOldHistoryAsync(user.Id, 5, cancellationToken);

            await _emailService.SendPasswordChangedNotificationAsync(
                user.Email.Value,
                user.FirstName,
                cancellationToken);

            _logger.LogInformation("Password changed successfully for user: {UserId}", user.Id);
            return Result.Success();
        }
    }
}

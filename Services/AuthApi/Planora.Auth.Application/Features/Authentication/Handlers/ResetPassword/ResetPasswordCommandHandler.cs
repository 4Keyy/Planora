using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;

namespace Planora.Auth.Application.Features.Authentication.Handlers.ResetPassword
{
    public sealed class ResetPasswordCommandHandler : IRequestHandler<ResetPasswordCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly IPasswordValidator _passwordValidator;
        private readonly IPasswordResetTokenService _tokenService;
        private readonly IEmailService _emailService;
        private readonly ILogger<ResetPasswordCommandHandler> _logger;

        public ResetPasswordCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            IPasswordValidator passwordValidator,
            IPasswordResetTokenService tokenService,
            IEmailService emailService,
            ILogger<ResetPasswordCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _passwordValidator = passwordValidator;
            _tokenService = tokenService;
            _emailService = emailService;
            _logger = logger;
        }

        public async Task<Result> Handle(
            ResetPasswordCommand command,
            CancellationToken cancellationToken)
        {
            try
            {
                var tokenHash = _tokenService.HashToken(command.ResetToken);
                var user = await _unitOfWork.Users.GetByPasswordResetTokenAsync(tokenHash, cancellationToken);

                if (user == null)
                {
                    _logger.LogWarning("Invalid password reset token");
                    return Result.Failure(
                        Error.Unauthorized("INVALID_TOKEN", "Password reset token is invalid or expired"));
                }

                if (!_tokenService.IsTokenValid(command.ResetToken, user.PasswordResetToken, user.PasswordResetTokenExpiry))
                {
                    user.ClearPasswordResetToken(user.Id);
                    _unitOfWork.Users.Update(user);
                    await _unitOfWork.SaveChangesAsync(cancellationToken);

                    _logger.LogWarning("Expired password reset token for user: {UserId}", user.Id);
                    return Result.Failure(
                        Error.Unauthorized("INVALID_TOKEN", "Password reset token is invalid or expired"));
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

                var newPasswordHash = _passwordHasher.HashPassword(command.NewPassword);
                user.ChangePassword(newPasswordHash, user.Id);

                _unitOfWork.Users.Update(user);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                await _emailService.SendPasswordChangedNotificationAsync(
                    user.Email.Value,
                    user.FirstName,
                    cancellationToken);

                _logger.LogInformation(
                    "Password reset successfully: {UserId}, Email: {Email}",
                    user.Id,
                    user.Email.Value);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error resetting password");
                return Result.Failure(
                    Error.InternalServer("RESET_PASSWORD_ERROR", "An error occurred while resetting password"));
            }
        }
    }
}

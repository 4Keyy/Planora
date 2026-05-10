using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Features.Authentication.Commands.RequestPasswordReset;
using Microsoft.Extensions.Options;

namespace Planora.Auth.Application.Features.Authentication.Handlers.RequestPasswordReset
{
    public sealed class RequestPasswordResetCommandHandler : IRequestHandler<RequestPasswordResetCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IEmailService _emailService;
        private readonly IPasswordResetTokenService _tokenService;
        private readonly IOptions<FrontendOptions> _frontendOptions;
        private readonly ILogger<RequestPasswordResetCommandHandler> _logger;

        public RequestPasswordResetCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IEmailService emailService,
            IPasswordResetTokenService tokenService,
            IOptions<FrontendOptions> frontendOptions,
            ILogger<RequestPasswordResetCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _emailService = emailService;
            _tokenService = tokenService;
            _frontendOptions = frontendOptions;
            _logger = logger;
        }

        public async Task<Result> Handle(
            RequestPasswordResetCommand command,
            CancellationToken cancellationToken)
        {
            try
            {
                Email email;
                try
                {
                    email = Email.Create(command.Email);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Invalid email format: {Email}", command.Email);
                    return Result.Success();
                }

                var user = await _unitOfWork.Users.GetByEmailAsync(email, cancellationToken);

                if (user == null)
                {
                    _logger.LogInformation(
                        "Password reset requested for non-existent email: {Email}",
                        email.Value);
                    return Result.Success();
                }

                if (user.IsLocked())
                {
                    _logger.LogWarning(
                        "Password reset requested for locked account: {UserId}",
                        user.Id);
                    return Result.Success();
                }

                var resetToken = _tokenService.GenerateToken();
                var resetTokenHash = _tokenService.HashToken(resetToken);
                user.SetPasswordResetToken(resetTokenHash, DateTime.UtcNow.Add(_tokenService.TokenLifetime));

                _unitOfWork.Users.Update(user);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                var resetLink = FrontendLinkBuilder.PasswordReset(_frontendOptions.Value, resetToken);

                await _emailService.SendPasswordResetEmailAsync(
                    user.Email.Value,
                    user.FirstName,
                    resetLink,
                    cancellationToken);

                _logger.LogInformation(
                    "Password reset email sent to: {Email}",
                    user.Email.Value);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error requesting password reset");
                return Result.Success();
            }
        }
    }
}

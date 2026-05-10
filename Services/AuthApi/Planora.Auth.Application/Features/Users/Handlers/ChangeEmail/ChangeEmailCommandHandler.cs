using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Features.Users.Commands.ChangeEmail;
using Microsoft.Extensions.Options;

namespace Planora.Auth.Application.Features.Users.Handlers.ChangeEmail
{
    public sealed class ChangeEmailCommandHandler : IRequestHandler<ChangeEmailCommand, Result>
    {
        private static readonly TimeSpan EmailVerificationTokenLifetime = TimeSpan.FromHours(24);

        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly ICurrentUserService _currentUserService;
        private readonly IEmailService _emailService;
        private readonly IOptions<FrontendOptions> _frontendOptions;
        private readonly ILogger<ChangeEmailCommandHandler> _logger;

        public ChangeEmailCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ICurrentUserService currentUserService,
            IEmailService emailService,
            IOptions<FrontendOptions> frontendOptions,
            ILogger<ChangeEmailCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _currentUserService = currentUserService;
            _emailService = emailService;
            _frontendOptions = frontendOptions;
            _logger = logger;
        }

        public async Task<Result> Handle(
            ChangeEmailCommand command,
            CancellationToken cancellationToken)
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
                _logger.LogWarning("Invalid password during email change: {UserId}", user.Id);
                return Result.Failure(
                    Error.Unauthorized("INVALID_PASSWORD", "Password is incorrect"));
            }

            Email newEmail;
            try
            {
                newEmail = Email.Create(command.NewEmail);
            }
            catch (Exception ex)
            {
                return Result.Failure(
                    Error.Validation(
                        "INVALID_EMAIL",
                        ex.Message,
                        new Dictionary<string, string[]>
                        {
                            ["NewEmail"] = new[] { ex.Message }
                        }));
            }

            var existingUser = await _unitOfWork.Users.GetByEmailAsync(newEmail, cancellationToken);
            if (existingUser != null)
            {
                return Result.Failure(
                    Error.Conflict("EMAIL_EXISTS", "Email is already in use"));
            }

            var verificationToken = OpaqueToken.Generate();

            user.ChangeEmail(newEmail, user.Id);
            user.SetEmailVerificationToken(
                OpaqueToken.Hash(verificationToken),
                DateTime.UtcNow.Add(EmailVerificationTokenLifetime));

            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            var verificationLink = FrontendLinkBuilder.EmailVerification(
                _frontendOptions.Value,
                verificationToken);

            await _emailService.SendEmailVerificationAsync(
                user.Email.Value,
                user.FirstName,
                verificationLink,
                cancellationToken);

            _logger.LogInformation(
                "Email changed for user: {UserId}, NewEmail: {Email}",
                user.Id,
                newEmail.Value);

            return Result.Success();
        }
    }
}

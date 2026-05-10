using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Features.Users.Commands.VerifyEmail;

namespace Planora.Auth.Application.Features.Users.Handlers.VerifyEmail
{
    public sealed class VerifyEmailCommandHandler : IRequestHandler<VerifyEmailCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ILogger<VerifyEmailCommandHandler> _logger;

        public VerifyEmailCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ILogger<VerifyEmailCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task<Result> Handle(
            VerifyEmailCommand command,
            CancellationToken cancellationToken)
        {
            try
            {
                var tokenHash = OpaqueToken.Hash(command.Token);
                var user = await _unitOfWork.Users.GetByEmailVerificationTokenAsync(
                    tokenHash,
                    cancellationToken);

                if (user == null)
                {
                    _logger.LogWarning("Invalid email verification token");
                    return Result.Failure(
                        Error.Unauthorized("INVALID_TOKEN", "Email verification token is invalid or expired"));
                }

                if (!user.HasValidEmailVerificationToken(tokenHash, DateTime.UtcNow))
                {
                    user.ClearEmailVerificationToken(user.Id);
                    _unitOfWork.Users.Update(user);
                    await _unitOfWork.SaveChangesAsync(cancellationToken);

                    _logger.LogWarning("Expired email verification token for user: {UserId}", user.Id);
                    return Result.Failure(
                        Error.Unauthorized("INVALID_TOKEN", "Email verification token is invalid or expired"));
                }

                if (user.EmailVerifiedAt.HasValue)
                {
                    user.ClearEmailVerificationToken(user.Id);
                }
                else
                {
                    user.VerifyEmail();
                }

                _unitOfWork.Users.Update(user);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Email verified successfully: {UserId}, Email: {Email}",
                    user.Id,
                    user.Email.Value);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error verifying email");
                return Result.Failure(
                    Error.InternalServer("VERIFY_EMAIL_ERROR", "An error occurred while verifying email"));
            }
        }
    }
}

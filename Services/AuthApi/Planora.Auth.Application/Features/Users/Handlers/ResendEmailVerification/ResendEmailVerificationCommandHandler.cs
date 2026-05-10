using Microsoft.Extensions.Options;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Security;
using Planora.Auth.Application.Features.Users.Commands.ResendEmailVerification;

namespace Planora.Auth.Application.Features.Users.Handlers.ResendEmailVerification;

public sealed class ResendEmailVerificationCommandHandler : IRequestHandler<ResendEmailVerificationCommand, Result>
{
    private static readonly TimeSpan EmailVerificationTokenLifetime = TimeSpan.FromHours(24);

    private readonly IAuthUnitOfWork _unitOfWork;
    private readonly ICurrentUserService _currentUserService;
    private readonly IEmailService _emailService;
    private readonly IOptions<FrontendOptions> _frontendOptions;
    private readonly ILogger<ResendEmailVerificationCommandHandler> _logger;

    public ResendEmailVerificationCommandHandler(
        IAuthUnitOfWork unitOfWork,
        ICurrentUserService currentUserService,
        IEmailService emailService,
        IOptions<FrontendOptions> frontendOptions,
        ILogger<ResendEmailVerificationCommandHandler> logger)
    {
        _unitOfWork = unitOfWork;
        _currentUserService = currentUserService;
        _emailService = emailService;
        _frontendOptions = frontendOptions;
        _logger = logger;
    }

    public async Task<Result> Handle(
        ResendEmailVerificationCommand command,
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

        if (user.EmailVerifiedAt.HasValue)
        {
            _logger.LogInformation(
                "Email verification resend skipped because email is already verified: {UserId}",
                user.Id);
            return Result.Success();
        }

        var verificationToken = OpaqueToken.Generate();
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
            "Email verification link resent for user: {UserId}, Email: {Email}",
            user.Id,
            user.Email.Value);

        return Result.Success();
    }
}

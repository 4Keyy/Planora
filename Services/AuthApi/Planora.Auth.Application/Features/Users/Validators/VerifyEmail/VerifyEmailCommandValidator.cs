using Planora.Auth.Application.Features.Users.Commands.VerifyEmail;

namespace Planora.Auth.Application.Features.Users.Validators.VerifyEmail
{
    public sealed class VerifyEmailCommandValidator : AbstractValidator<VerifyEmailCommand>
    {
        public VerifyEmailCommandValidator()
        {
            RuleFor(x => x.Token)
                .NotEmpty().WithMessage("Verification token is required")
                .MaximumLength(500).WithMessage("Verification token cannot exceed 500 characters");
        }
    }
}

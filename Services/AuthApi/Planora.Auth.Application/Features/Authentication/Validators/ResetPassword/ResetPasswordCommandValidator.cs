using Planora.Auth.Application.Features.Authentication.Commands.ResetPassword;

namespace Planora.Auth.Application.Features.Authentication.Validators.ResetPassword
{
    public sealed class ResetPasswordCommandValidator : AbstractValidator<ResetPasswordCommand>
    {
        public ResetPasswordCommandValidator()
        {
            RuleFor(x => x.ResetToken)
                .NotEmpty().WithMessage("Reset token is required");

            RuleFor(x => x.NewPassword)
                .NotEmpty().WithMessage("New password is required")
                .MinimumLength(8).WithMessage("Password must be at least 8 characters")
                .MaximumLength(128).WithMessage("Password cannot exceed 128 characters")
                .Matches(@"[A-Z]").WithMessage("Password must contain at least one uppercase letter")
                .Matches(@"[a-z]").WithMessage("Password must contain at least one lowercase letter")
                .Matches(@"[0-9]").WithMessage("Password must contain at least one digit")
                .Matches(@"[\W_]").WithMessage("Password must contain at least one special character");

            When(x => !string.IsNullOrWhiteSpace(x.ConfirmPassword), () =>
            {
                RuleFor(x => x.ConfirmPassword)
                    .Equal(x => x.NewPassword).WithMessage("Passwords do not match");
            });
        }
    }
}

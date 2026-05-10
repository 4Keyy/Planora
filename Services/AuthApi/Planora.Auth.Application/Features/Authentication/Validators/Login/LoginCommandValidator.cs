using Planora.Auth.Application.Features.Authentication.Commands.Login;

namespace Planora.Auth.Application.Features.Authentication.Validators.Login
{
    public sealed class LoginCommandValidator : AbstractValidator<LoginCommand>
    {
        public LoginCommandValidator()
        {
            RuleFor(x => x.Email)
                .NotEmpty().WithMessage("Email is required")
                .EmailAddress().WithMessage("Invalid email format");

            RuleFor(x => x.Password)
                .NotEmpty().WithMessage("Password is required");

            RuleFor(x => x.TwoFactorCode)
                .Length(6).WithMessage("2FA code must be 6 digits")
                .When(x => !string.IsNullOrEmpty(x.TwoFactorCode));
        }
    }
}

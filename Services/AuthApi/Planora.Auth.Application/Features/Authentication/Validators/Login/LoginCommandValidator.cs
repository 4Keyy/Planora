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
                .Must(code =>
                    System.Text.RegularExpressions.Regex.IsMatch(code!, @"^\d{6}$") ||
                    System.Text.RegularExpressions.Regex.IsMatch(code!, @"^[A-Z0-9]{5}-[A-Z0-9]{5}$"))
                .WithMessage("Enter a 6-digit 2FA code or a recovery code in XXXXX-XXXXX format")
                .When(x => !string.IsNullOrEmpty(x.TwoFactorCode));
        }
    }
}

using Planora.Auth.Application.Features.Users.Commands.Confirm2FA;

namespace Planora.Auth.Application.Features.Users.Validators.Confirm2FA
{
    public sealed class Confirm2FACommandValidator : AbstractValidator<Confirm2FACommand>
    {
        public Confirm2FACommandValidator()
        {
            RuleFor(x => x.Code)
                .NotEmpty().WithMessage("2FA code is required")
                .Length(6).WithMessage("2FA code must be 6 digits")
                .Matches(@"^\d{6}$").WithMessage("2FA code must contain only digits");
        }
    }
}

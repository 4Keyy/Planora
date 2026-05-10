using Planora.Auth.Application.Features.Users.Commands.Disable2FA;

namespace Planora.Auth.Application.Features.Users.Validators.Disable2FA
{
    public sealed class Disable2FACommandValidator : AbstractValidator<Disable2FACommand>
    {
        public Disable2FACommandValidator()
        {
            RuleFor(x => x.Password)
                .NotEmpty().WithMessage("Password is required to disable 2FA");
        }
    }
}

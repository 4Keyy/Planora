using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;

namespace Planora.Auth.Application.Features.Authentication.Validators.RefreshToken
{
    public sealed class RefreshTokenCommandValidator : AbstractValidator<RefreshTokenCommand>
    {
        public RefreshTokenCommandValidator()
        {
            RuleFor(x => x.RefreshToken)
                .NotEmpty().WithMessage("Refresh token is required");
        }
    }
}

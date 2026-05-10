using Planora.Auth.Application.Features.Users.Commands.RevokeSession;

namespace Planora.Auth.Application.Features.Users.Validators.RevokeSession
{
    public sealed class RevokeSessionCommandValidator : AbstractValidator<RevokeSessionCommand>
    {
        public RevokeSessionCommandValidator()
        {
            RuleFor(x => x.TokenId)
                .NotEmpty().WithMessage("Token ID is required");
        }
    }
}

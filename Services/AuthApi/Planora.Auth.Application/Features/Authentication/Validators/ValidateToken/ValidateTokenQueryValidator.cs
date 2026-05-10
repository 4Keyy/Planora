using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;

namespace Planora.Auth.Application.Features.Authentication.Validators.ValidateToken
{
    public sealed class ValidateTokenQueryValidator : AbstractValidator<ValidateTokenQuery>
    {
        public ValidateTokenQueryValidator()
        {
            RuleFor(x => x.Token)
                .NotEmpty().WithMessage("Token is required");
        }
    }
}

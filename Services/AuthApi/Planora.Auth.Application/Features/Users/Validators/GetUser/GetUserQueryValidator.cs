using Planora.Auth.Application.Features.Users.Queries.GetUser;

namespace Planora.Auth.Application.Features.Users.Validators.GetUser
{
    public sealed class GetUserQueryValidator : AbstractValidator<GetUserQuery>
    {
        public GetUserQueryValidator()
        {
            RuleFor(x => x.UserId)
                .NotEmpty().WithMessage("User ID is required");
        }
    }
}

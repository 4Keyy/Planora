using Planora.Auth.Application.Features.Users.Queries.GetUsers;

namespace Planora.Auth.Application.Features.Users.Validators.GetUsers
{
    public sealed class GetUsersQueryValidator : AbstractValidator<GetUsersQuery>
    {
        public GetUsersQueryValidator()
        {
            RuleFor(x => x.PageNumber)
                .GreaterThan(0).WithMessage("Page number must be greater than 0");

            RuleFor(x => x.PageSize)
                .GreaterThan(0).WithMessage("Page size must be greater than 0")
                .LessThanOrEqualTo(100).WithMessage("Page size cannot exceed 100");

            RuleFor(x => x.CreatedFrom)
                .LessThan(x => x.CreatedTo)
                .When(x => x.CreatedFrom.HasValue && x.CreatedTo.HasValue)
                .WithMessage("CreatedFrom must be earlier than CreatedTo");
        }
    }
}

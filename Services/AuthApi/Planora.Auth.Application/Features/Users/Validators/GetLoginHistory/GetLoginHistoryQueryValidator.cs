using Planora.Auth.Application.Features.Users.Queries.GetLoginHistory;

namespace Planora.Auth.Application.Features.Users.Validators.GetLoginHistory
{
    public sealed class GetLoginHistoryQueryValidator : AbstractValidator<GetLoginHistoryQuery>
    {
        public GetLoginHistoryQueryValidator()
        {
            RuleFor(x => x.PageNumber)
                .GreaterThan(0).WithMessage("Page number must be greater than 0");

            RuleFor(x => x.PageSize)
                .GreaterThan(0).WithMessage("Page size must be greater than 0")
                .LessThanOrEqualTo(100).WithMessage("Page size cannot exceed 100");
        }
    }
}

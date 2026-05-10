using Planora.Auth.Application.Features.Users.Queries.GetUsers;
using Planora.Auth.Application.Features.Users.Validators.GetUsers;

namespace Planora.UnitTests.Services.AuthApi.Users.Validators;

public sealed class GetUsersQueryValidatorTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAcceptDefaultPaginationAndAscendingDateRange()
    {
        var validator = new GetUsersQueryValidator();

        var result = validator.Validate(new GetUsersQuery
        {
            CreatedFrom = DateTime.UtcNow.AddDays(-7),
            CreatedTo = DateTime.UtcNow
        });

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldRejectInvertedCreatedRange()
    {
        var validator = new GetUsersQueryValidator();

        var result = validator.Validate(new GetUsersQuery
        {
            CreatedFrom = DateTime.UtcNow,
            CreatedTo = DateTime.UtcNow.AddDays(-1)
        });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error =>
            error.PropertyName == nameof(GetUsersQuery.CreatedFrom) &&
            error.ErrorMessage == "CreatedFrom must be earlier than CreatedTo");
    }
}

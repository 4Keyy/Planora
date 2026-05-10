using Planora.Auth.Application.Features.Users.Queries.GetLoginHistory;
using Planora.Auth.Application.Features.Users.Validators.GetLoginHistory;

namespace Planora.UnitTests.Services.AuthApi.Users.Validators;

public sealed class GetLoginHistoryQueryValidatorTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAcceptDefaultPagination()
    {
        var validator = new GetLoginHistoryQueryValidator();

        var result = validator.Validate(new GetLoginHistoryQuery());

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldRejectOutOfRangePaginationBackingFields()
    {
        var validator = new GetLoginHistoryQueryValidator();
        var query = new GetLoginHistoryQuery();
        SetPaginationBackingField(query, "_pageNumber", 0);
        SetPaginationBackingField(query, "_pageSize", 101);

        var result = validator.Validate(query);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.ErrorMessage == "Page number must be greater than 0");
        Assert.Contains(result.Errors, error => error.ErrorMessage == "Page size cannot exceed 100");

        SetPaginationBackingField(query, "_pageNumber", 1);
        SetPaginationBackingField(query, "_pageSize", 0);
        var zeroPageSize = validator.Validate(query);
        Assert.Contains(zeroPageSize.Errors, error => error.ErrorMessage == "Page size must be greater than 0");
    }

    private static void SetPaginationBackingField(GetLoginHistoryQuery query, string fieldName, int value)
    {
        typeof(GetLoginHistoryQuery).BaseType!
            .GetField(fieldName, System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)!
            .SetValue(query, value);
    }
}

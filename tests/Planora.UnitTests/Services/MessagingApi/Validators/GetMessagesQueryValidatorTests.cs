using Planora.Messaging.Application.Features.Messages.Queries.GetMessages;

namespace Planora.UnitTests.Services.MessagingApi.Validators;

public sealed class GetMessagesQueryValidatorTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldAcceptPositivePagingAndUserId()
    {
        var validator = new GetMessagesQueryValidator();

        var result = validator.Validate(new GetMessagesQuery(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Page: 1,
            PageSize: 50));

        Assert.True(result.IsValid);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Validate_ShouldRejectMissingUserAndOutOfRangePaging()
    {
        var validator = new GetMessagesQueryValidator();

        var result = validator.Validate(new GetMessagesQuery(
            Guid.Empty,
            Guid.NewGuid(),
            Page: 0,
            PageSize: 101));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(GetMessagesQuery.UserId));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(GetMessagesQuery.Page));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(GetMessagesQuery.PageSize));

        var zeroPageSize = validator.Validate(new GetMessagesQuery(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Page: 1,
            PageSize: 0));
        Assert.Contains(zeroPageSize.Errors, error => error.ErrorMessage == "PageSize must be greater than 0.");
    }
}

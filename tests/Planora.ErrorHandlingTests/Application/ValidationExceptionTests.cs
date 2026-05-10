using Planora.BuildingBlocks.Application.Validation;
using Xunit;
using FluentAssertions;

namespace Planora.ErrorHandlingTests.Application.Validation;

public class ValidationExceptionTests
{
    [Fact]
    public void ValidationException_ShouldHaveErrorCode()
    {
        var exception = new ValidationException();
        exception.ErrorCode.Should().Be("VALIDATION.INVALID_INPUT");
    }

    [Fact]
    public void ValidationException_ShouldStoreFieldErrors()
    {
        var errors = new Dictionary<string, string[]>
        {
            { "email", new[] { "Invalid email format" } },
            { "password", new[] { "Password too short", "Must contain uppercase" } }
        };

        var exception = new ValidationException("Validation failed", errors);

        exception.Errors.Should().HaveCount(2);
        exception.Errors["email"].Should().ContainSingle("Invalid email format");
        exception.Errors["password"].Should().Equal("Password too short", "Must contain uppercase");
    }

    [Fact]
    public void ValidationException_ShouldConvertFromFluentValidationFailures()
    {
        var failures = new List<FluentValidation.Results.ValidationFailure>
        {
            new FluentValidation.Results.ValidationFailure("email", "Email is required"),
            new FluentValidation.Results.ValidationFailure("email", "Invalid format"),
            new FluentValidation.Results.ValidationFailure("password", "Password is too weak")
        };

        var exception = new ValidationException(failures);

        exception.Errors.Should().HaveCount(2);
        exception.Errors["email"].Should().HaveCount(2);
        exception.Errors["password"].Should().ContainSingle("Password is too weak");
    }

    [Fact]
    public void ValidationException_ShouldAllowEmptyErrors()
    {
        var exception = new ValidationException();
        exception.Errors.Should().BeEmpty();
        exception.Message.Should().Contain("validation failures");
    }
}

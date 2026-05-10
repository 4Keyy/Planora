using Planora.BuildingBlocks.Domain.Exceptions;
using Xunit;
using FluentAssertions;

namespace Planora.ErrorHandlingTests.Domain.Exceptions;

public class ErrorCodeTests
{
    [Fact]
    public void ValidationErrorCodes_ShouldBeConsistent()
    {
        ErrorCode.Validation.InvalidInput.Should().StartWith("VALIDATION.");
        ErrorCode.Validation.MissingRequired.Should().StartWith("VALIDATION.");
        ErrorCode.Validation.InvalidFormat.Should().StartWith("VALIDATION.");
    }

    [Fact]
    public void AuthErrorCodes_ShouldBeConsistent()
    {
        ErrorCode.Auth.UserNotFound.Should().StartWith("AUTH.");
        ErrorCode.Auth.InvalidCredentials.Should().StartWith("AUTH.");
        ErrorCode.Auth.ExpiredToken.Should().StartWith("AUTH.");
    }

    [Fact]
    public void InfrastructureErrorCodes_ShouldBeConsistent()
    {
        ErrorCode.Infrastructure.DatabaseUnavailable.Should().StartWith("INFRASTRUCTURE.");
        ErrorCode.Infrastructure.RedisUnavailable.Should().StartWith("INFRASTRUCTURE.");
        ErrorCode.Infrastructure.TimeoutException.Should().StartWith("INFRASTRUCTURE.");
    }

    [Fact]
    public void SystemErrorCodes_ShouldBeConsistent()
    {
        ErrorCode.System.UnexpectedException.Should().StartWith("SYSTEM.");
        ErrorCode.System.InternalError.Should().StartWith("SYSTEM.");
    }
}

public class DomainExceptionTests
{
    [Fact]
    public void EntityNotFoundException_ShouldHaveNotFoundCategory()
    {
        var exception = new EntityNotFoundException("User", Guid.NewGuid());
        exception.Category.Should().Be(ErrorCategory.NotFound);
    }

    [Fact]
    public void EntityNotFoundException_ShouldContainDetails()
    {
        var userId = Guid.NewGuid();
        var exception = new EntityNotFoundException("User", userId);

        exception.Details.Should().ContainKey("EntityType").And.Contain(new KeyValuePair<string, object>("EntityType", "User"));
        exception.Details.Should().ContainKey("EntityId").And.Contain(new KeyValuePair<string, object>("EntityId", userId));
    }

    [Fact]
    public void EntityNotFoundException_ShouldMapToProblemDetailsContext()
    {
        var exception = new EntityNotFoundException("Todo", Guid.NewGuid());
        var context = exception.ToProblemDetailsContext("trace-123", "/api/todos/1", "user-456");

        context.StatusCode.Should().Be(404);
        context.ErrorCode.Should().Be(ErrorCode.NotFound.ResourceNotFound);
        context.Title.Should().Be("Not Found");
        context.TraceId.Should().Be("trace-123");
        context.UserId.Should().Be("user-456");
    }

    [Fact]
    public void ForbiddenException_ShouldHaveForbiddenCategory()
    {
        var exception = new ForbiddenException("Access denied");
        exception.Category.Should().Be(ErrorCategory.Forbidden);
    }

    [Fact]
    public void ConcurrencyException_ShouldHaveConflictCategory()
    {
        var exception = new ConcurrencyException("Item", Guid.NewGuid());
        exception.Category.Should().Be(ErrorCategory.Conflict);
    }

    [Fact]
    public void BusinessRuleViolationException_ShouldHaveConflictCategory()
    {
        var exception = new BusinessRuleViolationException("Invalid state transition");
        exception.Category.Should().Be(ErrorCategory.Conflict);
    }

    [Fact]
    public void DomainException_ShouldAllowAddingDetails()
    {
        var exception = new EntityNotFoundException("User", "john@example.com");
        exception.AddDetail("RetryCount", 3);
        exception.AddDetail("LastAttempt", DateTime.UtcNow);

        exception.Details.Should().HaveCount(4);
    }
}

public class ErrorCategoryMappingTests
{
    [Theory]
    [InlineData(ErrorCategory.Validation, 400)]
    [InlineData(ErrorCategory.Unauthorized, 401)]
    [InlineData(ErrorCategory.Forbidden, 403)]
    [InlineData(ErrorCategory.NotFound, 404)]
    [InlineData(ErrorCategory.Conflict, 409)]
    [InlineData(ErrorCategory.ServiceUnavailable, 503)]
    [InlineData(ErrorCategory.InternalServer, 500)]
    [InlineData(ErrorCategory.Unexpected, 500)]
    public void ErrorCategory_ShouldMapToCorrectHttpStatusCode(ErrorCategory category, int expectedStatus)
    {
        category.GetStatusCode().Should().Be(expectedStatus);
    }

    [Theory]
    [InlineData(ErrorCategory.Validation, "Validation Error")]
    [InlineData(ErrorCategory.Unauthorized, "Unauthorized")]
    [InlineData(ErrorCategory.Forbidden, "Forbidden")]
    [InlineData(ErrorCategory.NotFound, "Not Found")]
    [InlineData(ErrorCategory.Conflict, "Conflict")]
    [InlineData(ErrorCategory.ServiceUnavailable, "Service Unavailable")]
    [InlineData(ErrorCategory.InternalServer, "Internal Server Error")]
    [InlineData(ErrorCategory.Unexpected, "Unexpected Error")]
    public void ErrorCategory_ShouldMapToCorrectTitle(ErrorCategory category, string expectedTitle)
    {
        category.GetTitle().Should().Be(expectedTitle);
    }
}

public class ProblemDetailsContextTests
{
    [Fact]
    public void ProblemDetailsContext_ShouldSupportExtensions()
    {
        var context = new ProblemDetailsContext();
        context.AddExtension("retryAfter", 60);
        context.AddExtension("requestId", "req-123");

        context.Extensions.Should().NotBeNull();
        context.Extensions.Should().HaveCount(2);
        context.Extensions.Should().Contain(new KeyValuePair<string, object>("retryAfter", 60));
    }

    [Fact]
    public void ProblemDetailsContext_ShouldSupportValidationErrors()
    {
        var context = new ProblemDetailsContext();
        context.AddValidationError("email", "Invalid email format", "Email is required");
        context.AddValidationError("password", "Password too short");

        context.ValidationErrors.Should().NotBeNull();
        context.ValidationErrors.Should().HaveCount(2);
        context.ValidationErrors["email"].Should().HaveCount(2);
        context.ValidationErrors["password"].Should().ContainSingle("Password too short");
    }

    [Fact]
    public void ProblemDetailsContext_ShouldMaintainAllProperties()
    {
        var context = new ProblemDetailsContext
        {
            ErrorCode = "TEST.ERROR",
            Title = "Test Error",
            Detail = "This is a test error",
            StatusCode = 400,
            Instance = "/api/test",
            TraceId = "trace-123",
            UserId = "user-456",
            ElapsedMilliseconds = 150
        };

        context.ErrorCode.Should().Be("TEST.ERROR");
        context.StatusCode.Should().Be(400);
        context.UserId.Should().Be("user-456");
        context.ElapsedMilliseconds.Should().Be(150);
    }
}

using Planora.Auth.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Application.Exceptions;
using Planora.Todo.Domain.Exceptions;

namespace Planora.UnitTests.Services.AuthApi.Domain;

public sealed class AuthDomainExceptionTests
{
    [Theory]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    [InlineData("expired")]
    [InlineData("revoked")]
    public void InvalidRefreshTokenException_ShouldExposeUnauthorizedCategoryAndReason(string reason)
    {
        var exception = new InvalidRefreshTokenException(reason);

        Assert.Equal(ErrorCategory.Unauthorized, exception.Category);
        Assert.Contains(reason, exception.Message, StringComparison.Ordinal);
        Assert.Equal(reason, exception.Details["Reason"]);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void UserAlreadyExistsException_ShouldExposeConflictCategoryAndEmail()
    {
        var exception = new UserAlreadyExistsException("user@example.com");

        Assert.Equal(ErrorCategory.Conflict, exception.Category);
        Assert.Contains("user@example.com", exception.Message, StringComparison.Ordinal);
        Assert.Equal("user@example.com", exception.Details["Email"]);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void AuthCredentialExceptions_ShouldExposeUnauthorizedCategoryAndCodes()
    {
        var missingRefreshToken = new RefreshTokenNotFoundException();
        var invalidCredentials = new InvalidCredentialsException();
        var defaultAuth = new AuthDomainException("Token failed");
        var customAuth = new AuthDomainException("Custom auth failed", "AUTH.CUSTOM");

        Assert.Equal(ErrorCategory.Unauthorized, missingRefreshToken.Category);
        Assert.Equal(ErrorCode.Auth.RefreshTokenNotFound, missingRefreshToken.ErrorCode);
        Assert.Contains("Refresh token not found", missingRefreshToken.Message, StringComparison.Ordinal);
        Assert.Equal(ErrorCategory.Unauthorized, invalidCredentials.Category);
        Assert.Equal(ErrorCode.Auth.InvalidCredentials, invalidCredentials.ErrorCode);
        Assert.Equal("Invalid email or password", invalidCredentials.Message);
        Assert.Equal(ErrorCategory.Unauthorized, defaultAuth.Category);
        Assert.Equal(ErrorCode.Auth.InvalidToken, defaultAuth.ErrorCode);
        Assert.Equal("AUTH.CUSTOM", customAuth.ErrorCode);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void WeakPasswordException_ShouldExposeValidationCategoryAndReason()
    {
        var exception = new WeakPasswordException("missing digit");

        Assert.Equal(ErrorCategory.Validation, exception.Category);
        Assert.Contains("missing digit", exception.Message, StringComparison.Ordinal);
        Assert.Equal("missing digit", exception.Details["Reason"]);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void SharedDomainExceptions_ShouldPreserveCategoryCodeAndInnerException()
    {
        var inner = new InvalidOperationException("inner");
        var business = new BusinessRuleViolationException("Rule failed", "RULE.FAILED", inner);
        var forbidden = new ForbiddenException("Access denied", "ACCESS.DENIED", inner);

        Assert.Equal(ErrorCategory.Conflict, business.Category);
        Assert.Equal("RULE.FAILED", business.ErrorCode);
        Assert.Same(inner, business.InnerException);
        Assert.Equal(ErrorCategory.Forbidden, forbidden.Category);
        Assert.Equal("ACCESS.DENIED", forbidden.ErrorCode);
        Assert.Same(inner, forbidden.InnerException);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void TodoItemNotFoundDomainException_ShouldExposeMissingTodoIdDetail()
    {
        var todoId = Guid.NewGuid();

        var exception = new TodoItemNotFoundDomainException(todoId);

        Assert.Equal("TODO_NOT_FOUND", exception.ErrorCode);
        Assert.Contains(todoId.ToString(), exception.Message, StringComparison.Ordinal);
        Assert.Equal(todoId, exception.Details["TodoItemId"]);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public void ExternalServiceUnavailableException_ShouldPreserveServiceOperationAndInnerException()
    {
        var inner = new HttpRequestException("connection failed");

        var exception = new ExternalServiceUnavailableException("CategoryApi", "ValidateCategory", inner);

        Assert.Equal(ErrorCategory.ServiceUnavailable, exception.Category);
        Assert.Equal(ErrorCode.Infrastructure.ExternalServiceUnavailable, exception.ErrorCode);
        Assert.Same(inner, exception.InnerException);
        Assert.Equal("CategoryApi", exception.Details["ServiceName"]);
        Assert.Equal("ValidateCategory", exception.Details["OperationName"]);
    }
}

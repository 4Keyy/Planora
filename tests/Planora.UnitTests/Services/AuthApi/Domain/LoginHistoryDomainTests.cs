using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Exceptions;

namespace Planora.UnitTests.Services.AuthApi.Domain;

public sealed class LoginHistoryDomainTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Constructor_ShouldValidateRequiredFieldsAndExposeLoginAttempt()
    {
        var userId = Guid.NewGuid();

        var history = new LoginHistory(userId, "127.0.0.1", "Chrome", false, "bad password");

        Assert.Equal(userId, history.UserId);
        Assert.Equal("127.0.0.1", history.IpAddress);
        Assert.Equal("Chrome", history.UserAgent);
        Assert.False(history.IsSuccessful);
        Assert.Equal("bad password", history.FailureReason);
        Assert.True(history.LoginAt <= DateTime.UtcNow);
        Assert.Throws<AuthDomainException>(() => new LoginHistory(Guid.Empty, "127.0.0.1", "Chrome", true));
        Assert.Throws<AuthDomainException>(() => new LoginHistory(userId, "", "Chrome", true));
        Assert.Throws<AuthDomainException>(() => new LoginHistory(userId, "127.0.0.1", "", true));
    }
}

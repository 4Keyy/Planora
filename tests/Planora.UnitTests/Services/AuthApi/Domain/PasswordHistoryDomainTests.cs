using Planora.Auth.Domain.Entities;

namespace Planora.UnitTests.Services.AuthApi.Domain;

public sealed class PasswordHistoryDomainTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Constructor_ShouldRequireUserAndPasswordHashAndSetChangeTimestamp()
    {
        var userId = Guid.NewGuid();
        var before = DateTime.UtcNow;

        var history = new PasswordHistory(userId, "password-hash");

        Assert.Equal(userId, history.UserId);
        Assert.Equal("password-hash", history.PasswordHash);
        Assert.True(history.ChangedAt >= before);
        Assert.False(history.IsOlderThan(1));
        Assert.Throws<ArgumentException>(() => new PasswordHistory(Guid.Empty, "hash"));
        Assert.Throws<ArgumentException>(() => new PasswordHistory(userId, ""));
        var efConstructor = typeof(PasswordHistory).GetConstructor(
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic,
            binder: null,
            Type.EmptyTypes,
            modifiers: null);
        var efInstance = Assert.IsType<PasswordHistory>(efConstructor!.Invoke(null));
        Assert.Equal(string.Empty, efInstance.PasswordHash);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void IsOlderThan_ShouldCompareChangedAtAgainstUtcThreshold()
    {
        var history = new PasswordHistory(Guid.NewGuid(), "password-hash");
        typeof(PasswordHistory).GetProperty(nameof(PasswordHistory.ChangedAt))!
            .SetValue(history, DateTime.UtcNow.AddDays(-10));

        Assert.True(history.IsOlderThan(7));
        Assert.False(history.IsOlderThan(30));
    }
}

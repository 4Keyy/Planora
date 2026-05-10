using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Exceptions;
using Planora.Auth.Domain.ValueObjects;

namespace Planora.UnitTests.Services.AuthApi.Domain;

public class UserDomainTests
{
    [Fact]
    public void Create_ShouldInitializePendingUserAndRaiseCreatedEvent()
    {
        var user = CreateUser();

        Assert.Equal("user@example.com", user.Email.Value);
        Assert.Equal("First Last", user.FullName);
        Assert.Empty(user.UserRoles);
        Assert.Equal(UserStatus.PendingVerification, user.Status);
        Assert.False(user.IsEmailVerified);
        Assert.False(user.IsActive);
        Assert.Contains(user.DomainEvents, e => e.GetType().Name == "UserCreatedEvent");
    }

    [Theory]
    [InlineData("", "First", "Last")]
    [InlineData("hash", "", "Last")]
    [InlineData("hash", "First", "")]
    public void Create_ShouldRejectMissingRequiredFields(string passwordHash, string firstName, string lastName)
    {
        Assert.Throws<AuthDomainException>(() =>
            User.Create(Email.Create("user@example.com"), passwordHash, firstName, lastName));
    }

    [Fact]
    public void VerifyEmail_ShouldActivateUserAndConsumeVerificationToken()
    {
        var user = CreateUser();
        user.SetEmailVerificationToken("token-hash", DateTime.UtcNow.AddHours(1));

        Assert.True(user.HasValidEmailVerificationToken("token-hash", DateTime.UtcNow));

        user.VerifyEmail();

        Assert.True(user.IsEmailVerified);
        Assert.True(user.IsActive);
        Assert.Equal(UserStatus.Active, user.Status);
        Assert.NotNull(user.EmailVerifiedAt);
        Assert.Null(user.EmailVerificationToken);
        Assert.Null(user.EmailVerificationTokenExpiry);
        Assert.Contains(user.DomainEvents, e => e.GetType().Name == "EmailVerifiedEvent");
        Assert.Throws<AuthDomainException>(() => user.VerifyEmail());
    }

    [Fact]
    public void EmailVerificationToken_ShouldValidateHashAndExpiry()
    {
        var user = CreateUser();
        var expiresAt = DateTime.UtcNow.AddMinutes(30);

        user.SetEmailVerificationToken("hash", expiresAt);

        Assert.True(user.HasValidEmailVerificationToken("hash", DateTime.UtcNow));
        Assert.False(user.HasValidEmailVerificationToken("wrong", DateTime.UtcNow));
        Assert.False(user.HasValidEmailVerificationToken("hash", expiresAt.AddTicks(1)));

        user.ClearEmailVerificationToken(user.Id);

        Assert.False(user.HasValidEmailVerificationToken("hash", DateTime.UtcNow));
    }

    [Fact]
    public void SetEmailVerificationToken_ShouldRejectEmptyOrExpiredToken()
    {
        var user = CreateUser();

        Assert.Throws<AuthDomainException>(() =>
            user.SetEmailVerificationToken("", DateTime.UtcNow.AddHours(1)));
        Assert.Throws<AuthDomainException>(() =>
            user.SetEmailVerificationToken("hash", DateTime.UtcNow.AddSeconds(-1)));
    }

    [Fact]
    public void AddRefreshToken_ShouldRevokeExistingActiveTokens()
    {
        var user = CreateUser();

        var first = user.AddRefreshToken("first-token", "127.0.0.1", DateTime.UtcNow.AddDays(1));
        var second = user.AddRefreshToken("second-token", "127.0.0.1", DateTime.UtcNow.AddDays(1));

        Assert.False(first.IsActive);
        Assert.True(first.IsRevoked);
        Assert.True(second.IsActive);
        Assert.Equal(2, user.RefreshTokens.Count);
    }

    [Fact]
    public void RevokeRefreshToken_ShouldRejectMissingOrInactiveToken()
    {
        var user = CreateUser();
        var token = user.AddRefreshToken("refresh-token", "127.0.0.1", DateTime.UtcNow.AddDays(1));

        user.RevokeRefreshToken(token.Token, "127.0.0.1", "logout");

        Assert.False(token.IsActive);
        Assert.Throws<AuthDomainException>(() =>
            user.RevokeRefreshToken("missing-token", "127.0.0.1", "logout"));
        Assert.Throws<AuthDomainException>(() =>
            user.RevokeRefreshToken(token.Token, "127.0.0.1", "logout-again"));
    }

    [Fact]
    public void PasswordResetToken_ShouldBePurposeScopedAndConsumedByPasswordChange()
    {
        var user = CreateUser();
        var refreshToken = user.AddRefreshToken("refresh-token", "127.0.0.1", DateTime.UtcNow.AddDays(1));
        var expiresAt = DateTime.UtcNow.AddMinutes(30);

        user.SetPasswordResetToken("reset-hash", expiresAt);

        Assert.True(user.HasValidPasswordResetToken("reset-hash", DateTime.UtcNow));
        Assert.False(user.HasValidPasswordResetToken("wrong", DateTime.UtcNow));
        Assert.False(user.HasValidPasswordResetToken("reset-hash", expiresAt.AddTicks(1)));

        user.ChangePassword("new-password-hash", user.Id);

        Assert.Equal("new-password-hash", user.PasswordHash);
        Assert.Null(user.PasswordResetToken);
        Assert.Null(user.PasswordResetTokenExpiry);
        Assert.False(refreshToken.IsActive);
        Assert.Contains(user.DomainEvents, e => e.GetType().Name == "PasswordChangedEvent");
    }

    [Fact]
    public void PasswordResetToken_ShouldRejectInvalidValuesAndClearManually()
    {
        var user = CreateUser();

        Assert.Throws<AuthDomainException>(() =>
            user.SetPasswordResetToken("", DateTime.UtcNow.AddMinutes(30)));
        Assert.Throws<AuthDomainException>(() =>
            user.SetPasswordResetToken("hash", DateTime.UtcNow.AddSeconds(-1)));
        Assert.Throws<AuthDomainException>(() => user.ChangePassword("", user.Id));

        user.SetPasswordResetToken("hash", DateTime.UtcNow.AddMinutes(30));
        user.ClearPasswordResetToken(user.Id);

        Assert.Null(user.PasswordResetToken);
        Assert.Null(user.PasswordResetTokenExpiry);
        Assert.False(user.HasValidPasswordResetToken("hash", DateTime.UtcNow));
    }

    [Fact]
    public void ChangeEmail_ShouldResetVerificationStateAndIgnoreSameEmail()
    {
        var user = CreateUser();
        user.SetEmailVerificationToken("hash", DateTime.UtcNow.AddHours(1));
        user.VerifyEmail();
        var verifiedAt = user.EmailVerifiedAt;

        user.ChangeEmail(Email.Create("user@example.com"), user.Id);

        Assert.True(user.IsEmailVerified);
        Assert.Equal(verifiedAt, user.EmailVerifiedAt);

        user.ChangeEmail(Email.Create("new@example.com"), user.Id);

        Assert.Equal("new@example.com", user.Email.Value);
        Assert.False(user.IsEmailVerified);
        Assert.Null(user.EmailVerifiedAt);
        Assert.Null(user.EmailVerificationToken);
        Assert.Contains(user.DomainEvents, e => e.GetType().Name == "EmailChangedEvent");
    }

    [Fact]
    public void ProfileAndTwoFactorMethods_ShouldValidateAndToggleState()
    {
        var user = CreateUser();

        Assert.Throws<AuthDomainException>(() => user.UpdateProfile("", "Last", null, user.Id));
        Assert.Throws<AuthDomainException>(() => user.UpdateProfile("First", "", null, user.Id));

        user.UpdateProfile("  Ada  ", "  Lovelace ", "  https://cdn/avatar.png  ", user.Id);

        Assert.Equal("Ada Lovelace", user.FullName);
        Assert.Equal("https://cdn/avatar.png", user.ProfilePictureUrl);

        Assert.Throws<AuthDomainException>(() => user.EnableTwoFactor(""));
        user.EnableTwoFactor("secret");
        Assert.True(user.TwoFactorEnabled);
        Assert.True(user.IsTwoFactorEnabled);
        Assert.Equal("secret", user.TwoFactorSecret);
        Assert.Throws<AuthDomainException>(() => user.EnableTwoFactor("another-secret"));

        user.DisableTwoFactor();
        Assert.False(user.TwoFactorEnabled);
        Assert.False(user.IsTwoFactorEnabled);
        Assert.Null(user.TwoFactorSecret);
        Assert.Throws<AuthDomainException>(() => user.DisableTwoFactor());
    }

    [Fact]
    public void AccountStateMethods_ShouldLockUnlockDeactivateAndActivate()
    {
        var user = CreateUser();
        user.VerifyEmail();
        var token = user.AddRefreshToken("refresh-token", "127.0.0.1", DateTime.UtcNow.AddDays(1));

        user.LockAccount();

        Assert.True(user.IsLocked());
        Assert.Equal(UserStatus.Locked, user.Status);
        Assert.NotNull(user.LockedUntil);

        user.Unlock(user.Id);

        Assert.False(user.IsLocked());
        Assert.Equal(UserStatus.Active, user.Status);
        Assert.Equal(0, user.FailedLoginAttempts);

        user.Deactivate(user.Id);

        Assert.Equal(UserStatus.Inactive, user.Status);
        Assert.False(user.IsActive);
        Assert.False(token.IsActive);

        user.Activate(user.Id);

        Assert.Equal(UserStatus.Active, user.Status);
        Assert.True(user.IsActive);
    }

    [Fact]
    public void AccountStateMethods_ShouldHandleIdempotentTransitionsFriendEligibilityAndLoginReset()
    {
        var user = CreateUser();

        Assert.False(user.CanAddFriends());

        user.VerifyEmail();

        Assert.True(user.CanAddFriends());

        user.IncrementFailedLoginAttempts();
        user.IncrementFailedLoginAttempts();
        SetProperty(user, nameof(User.LockedUntil), DateTime.UtcNow.AddMinutes(-5));
        SetProperty(user, nameof(User.LockoutEndDate), DateTime.UtcNow.AddMinutes(-5));

        Assert.False(user.IsLocked());
        Assert.Equal(0, user.FailedLoginAttempts);

        user.IncrementFailedLoginAttempts();
        SetProperty(user, nameof(User.LockedUntil), DateTime.UtcNow.AddMinutes(-5));
        SetProperty(user, nameof(User.LockoutEndDate), DateTime.UtcNow.AddMinutes(-5));

        user.UpdateLastLogin();

        Assert.NotNull(user.LastLoginAt);
        Assert.Equal(0, user.FailedLoginAttempts);
        Assert.Null(user.LockedUntil);
        Assert.Null(user.LockoutEndDate);

        user.Deactivate(user.Id);
        user.Deactivate(user.Id);
        Assert.Equal(UserStatus.Inactive, user.Status);

        user.Activate(user.Id);
        user.Activate(user.Id);
        Assert.Equal(UserStatus.Active, user.Status);

        user.Lock(user.Id);
        user.Lock(user.Id);
        Assert.Equal(UserStatus.Locked, user.Status);

        SetProperty(user, nameof(User.LockedUntil), DateTime.UtcNow.AddMinutes(-5));
        SetProperty(user, nameof(User.LockoutEndDate), DateTime.UtcNow.AddMinutes(-5));
        Assert.False(user.IsLocked());
        Assert.Equal(UserStatus.Active, user.Status);

        user.Lock(user.Id);
        user.Unlock(user.Id);
        user.Unlock(user.Id);
        Assert.Equal(UserStatus.Active, user.Status);

        user.ResetFailedLoginAttempts();
        Assert.Equal(0, user.FailedLoginAttempts);
    }

    private static User CreateUser() =>
        User.Create(Email.Create("user@example.com"), "password-hash", "First", "Last");

    private static void SetProperty<T>(T instance, string propertyName, object? value)
    {
        var property = typeof(T).GetProperty(propertyName)
            ?? throw new InvalidOperationException($"Property {propertyName} was not found on {typeof(T).Name}.");
        property.SetValue(instance, value);
    }
}

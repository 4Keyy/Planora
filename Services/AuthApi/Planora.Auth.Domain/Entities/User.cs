using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Events;
using Planora.Auth.Domain.Exceptions;
using Planora.Auth.Domain.ValueObjects;

namespace Planora.Auth.Domain.Entities;

public sealed class User : BaseEntity, IAggregateRoot
{
    private readonly List<RefreshToken> _refreshTokens = new();
    private readonly List<LoginHistory> _loginHistory = new();
    private readonly List<UserRole> _userRoles = new();

    public Email Email { get; private set; }
    public string PasswordHash { get; private set; }
    public string FirstName { get; private set; }
    public string LastName { get; private set; }
    public string? ProfilePictureUrl { get; private set; }
    public UserStatus Status { get; private set; }

    // Email Verification
    public bool IsEmailVerified { get; private set; }
    public DateTime? EmailVerifiedAt { get; private set; }
    public string? EmailVerificationToken { get; private set; }
    public DateTime? EmailVerificationTokenExpiry { get; private set; }

    // Login & Security
    public DateTime? LastLoginAt { get; private set; }
    public int FailedLoginAttempts { get; private set; }
    public DateTime? LockedUntil { get; private set; }
    public DateTime? LockoutEndDate { get; private set; }

    // Two-Factor Authentication
    public bool IsTwoFactorEnabled { get; private set; }
    public bool TwoFactorEnabled { get; private set; }
    public string? TwoFactorSecret { get; private set; }

    // Password Management
    public DateTime? LastPasswordChangedAt { get; private set; }
    public string? PasswordResetToken { get; private set; }
    public DateTime? PasswordResetTokenExpiry { get; private set; }

    // Status Check
    public bool IsActive => Status == UserStatus.Active && !IsDeleted;

    // Navigation Properties
    public IReadOnlyCollection<RefreshToken> RefreshTokens => _refreshTokens.AsReadOnly();
    public IReadOnlyCollection<LoginHistory> LoginHistory => _loginHistory.AsReadOnly();
    public IReadOnlyCollection<UserRole> UserRoles => _userRoles.AsReadOnly();

    // Computed Properties
    public IReadOnlyCollection<string> Roles => _userRoles.Select(ur => ur.Role?.Name ?? string.Empty).ToList().AsReadOnly();
    public string FullName => $"{FirstName} {LastName}".Trim();

    private User()
    {
        Email = null!;
        PasswordHash = string.Empty;
        FirstName = string.Empty;
        LastName = string.Empty;
    }

    private User(Email email, string passwordHash, string firstName, string lastName)
    {
        Email = email;
        PasswordHash = passwordHash;
        FirstName = firstName;
        LastName = lastName;
        Status = UserStatus.PendingVerification;
        FailedLoginAttempts = 0;
        TwoFactorEnabled = false;
        IsTwoFactorEnabled = false;
        IsEmailVerified = false;
        LastPasswordChangedAt = DateTime.UtcNow;
    }

    public static User Create(Email email, string passwordHash, string firstName, string lastName)
    {
        if (string.IsNullOrWhiteSpace(passwordHash))
            throw new AuthDomainException("Password hash cannot be empty");
        if (string.IsNullOrWhiteSpace(firstName))
            throw new AuthDomainException("First name cannot be empty");
        if (string.IsNullOrWhiteSpace(lastName))
            throw new AuthDomainException("Last name cannot be empty");

        var user = new User(email, passwordHash, firstName, lastName);
        user.AddDomainEvent(new UserCreatedEvent(user.Id, user.Email.Value, user.FirstName, user.LastName));

        return user;
    }

    public void VerifyEmail()
    {
        if (IsEmailVerified)
            throw new AuthDomainException("Email already verified");

        IsEmailVerified = true;
        EmailVerifiedAt = DateTime.UtcNow;
        EmailVerificationToken = null;
        EmailVerificationTokenExpiry = null;
        Status = UserStatus.Active;

        AddDomainEvent(new EmailVerifiedEvent(Id, Email.Value));
    }

    public void SetEmailVerificationToken(string tokenHash, DateTime expiresAt)
    {
        if (string.IsNullOrWhiteSpace(tokenHash))
            throw new AuthDomainException("Email verification token hash cannot be empty");
        if (expiresAt <= DateTime.UtcNow)
            throw new AuthDomainException("Email verification token expiry must be in the future");

        EmailVerificationToken = tokenHash;
        EmailVerificationTokenExpiry = expiresAt;

        MarkAsModified(Id);
    }

    public bool HasValidEmailVerificationToken(string tokenHash, DateTime utcNow)
    {
        return !string.IsNullOrWhiteSpace(EmailVerificationToken) &&
               EmailVerificationTokenExpiry.HasValue &&
               EmailVerificationTokenExpiry.Value > utcNow &&
               string.Equals(EmailVerificationToken, tokenHash, StringComparison.Ordinal);
    }

    public void ClearEmailVerificationToken(Guid changedBy)
    {
        EmailVerificationToken = null;
        EmailVerificationTokenExpiry = null;

        MarkAsModified(changedBy);
    }

    public void LockAccount()
    {
        LockedUntil = DateTime.UtcNow.AddMinutes(15);
        LockoutEndDate = LockedUntil;
        Status = UserStatus.Locked;
        AddDomainEvent(new UserLockedEvent(Id, Email.Value, LockedUntil.Value));
    }

    public void IncrementFailedLoginAttempts()
    {
        FailedLoginAttempts++;
    }

    public bool IsLocked()
    {
        if ((LockedUntil.HasValue && LockedUntil.Value < DateTime.UtcNow) ||
            (LockoutEndDate.HasValue && LockoutEndDate.Value < DateTime.UtcNow))
        {
            LockedUntil = null;
            LockoutEndDate = null;
            FailedLoginAttempts = 0;
            if (Status == UserStatus.Locked)
                Status = UserStatus.Active;
        }

        if (Status == UserStatus.Locked) return true;

        if (LockedUntil.HasValue && LockedUntil.Value > DateTime.UtcNow) return true;

        if (LockoutEndDate.HasValue && LockoutEndDate.Value > DateTime.UtcNow) return true;

        return false;
    }

    public RefreshToken AddRefreshToken(string token, string ipAddress, DateTime expiresAt)
    {
        // Revoke existing active tokens
        var activeTokens = _refreshTokens
            .Where(t => t.IsActive)
            .ToList();

        foreach (var activeToken in activeTokens)
        {
            activeToken.Revoke(ipAddress, "Superseded by new token");
        }

        // NOTE: Clean up old inactive tokens disabled to avoid concurrency issues
        // EF Core tracking makes it difficult to safely modify tokens in the same transaction
        // Background job should handle cleanup instead

        var refreshToken = new RefreshToken(Id, token, ipAddress, expiresAt);
        _refreshTokens.Add(refreshToken);

        return refreshToken;
    }

    public void RevokeRefreshToken(string token, string ipAddress, string reason)
    {
        var refreshToken = _refreshTokens.FirstOrDefault(t => t.Token == token);
        if (refreshToken == null)
            throw new AuthDomainException("Refresh token not found");
        if (!refreshToken.IsActive)
            throw new AuthDomainException("Refresh token is already revoked");

        refreshToken.Revoke(ipAddress, reason);
    }

    public void RevokeAllRefreshTokens(string ipAddress, string reason = "Revoked all tokens")
    {
        foreach (var token in _refreshTokens.Where(t => t.IsActive))
        {
            token.Revoke(ipAddress, reason);
        }

        AddDomainEvent(new AllRefreshTokensRevokedEvent(Id));
    }

    public void ChangePassword(string newPasswordHash, Guid changedBy)
    {
        if (string.IsNullOrWhiteSpace(newPasswordHash))
            throw new AuthDomainException("Password hash cannot be empty");

        PasswordHash = newPasswordHash;
        LastPasswordChangedAt = DateTime.UtcNow;
        PasswordResetToken = null;
        PasswordResetTokenExpiry = null;

        MarkAsModified(changedBy);
        RevokeAllRefreshTokens("system", "Password changed");

        AddDomainEvent(new PasswordChangedEvent(Id, Email.Value));
    }

    public void SetPasswordResetToken(string tokenHash, DateTime expiresAt)
    {
        if (string.IsNullOrWhiteSpace(tokenHash))
            throw new AuthDomainException("Password reset token hash cannot be empty");
        if (expiresAt <= DateTime.UtcNow)
            throw new AuthDomainException("Password reset token expiry must be in the future");

        PasswordResetToken = tokenHash;
        PasswordResetTokenExpiry = expiresAt;

        MarkAsModified(Id);
    }

    public bool HasValidPasswordResetToken(string tokenHash, DateTime utcNow)
    {
        return !string.IsNullOrWhiteSpace(PasswordResetToken) &&
               PasswordResetTokenExpiry.HasValue &&
               PasswordResetTokenExpiry.Value > utcNow &&
               string.Equals(PasswordResetToken, tokenHash, StringComparison.Ordinal);
    }

    public void ClearPasswordResetToken(Guid changedBy)
    {
        PasswordResetToken = null;
        PasswordResetTokenExpiry = null;

        MarkAsModified(changedBy);
    }

    public void UpdateProfile(string firstName, string lastName, string? profilePictureUrl, Guid updatedBy)
    {
        if (string.IsNullOrWhiteSpace(firstName))
            throw new AuthDomainException("First name cannot be empty");
        if (string.IsNullOrWhiteSpace(lastName))
            throw new AuthDomainException("Last name cannot be empty");

        FirstName = firstName.Trim();
        LastName = lastName.Trim();
        ProfilePictureUrl = profilePictureUrl?.Trim();

        MarkAsModified(updatedBy);
        AddDomainEvent(new UserProfileUpdatedEvent(Id));
    }

    public void ChangeEmail(Email newEmail, Guid changedBy)
    {
        if (Email.Equals(newEmail)) return;

        var oldEmail = Email.Value;
        Email = newEmail;
        IsEmailVerified = false;
        EmailVerifiedAt = null;
        EmailVerificationToken = null;
        EmailVerificationTokenExpiry = null;

        MarkAsModified(changedBy);
        AddDomainEvent(new EmailChangedEvent(Id, oldEmail, newEmail.Value));
    }

    public void EnableTwoFactor(string secret)
    {
        if (string.IsNullOrWhiteSpace(secret))
            throw new AuthDomainException("2FA secret cannot be empty");
        if (TwoFactorEnabled || IsTwoFactorEnabled)
            throw new AuthDomainException("2FA is already enabled");

        TwoFactorEnabled = true;
        IsTwoFactorEnabled = true;
        TwoFactorSecret = secret;

        AddDomainEvent(new TwoFactorEnabledEvent(Id));
    }

    public void DisableTwoFactor()
    {
        if (!TwoFactorEnabled && !IsTwoFactorEnabled)
            throw new AuthDomainException("2FA is not enabled");

        TwoFactorEnabled = false;
        IsTwoFactorEnabled = false;
        TwoFactorSecret = null;

        AddDomainEvent(new TwoFactorDisabledEvent(Id));
    }

    public void Deactivate(Guid deactivatedBy)
    {
        if (Status == UserStatus.Inactive) return;

        Status = UserStatus.Inactive;
        RevokeAllRefreshTokens("system", "User deactivated");

        MarkAsModified(deactivatedBy);
        AddDomainEvent(new UserDeactivatedEvent(Id, Email.Value));
    }

    public void Activate(Guid activatedBy)
    {
        if (Status == UserStatus.Active) return;

        Status = UserStatus.Active;
        FailedLoginAttempts = 0;
        LockedUntil = null;
        LockoutEndDate = null;

        MarkAsModified(activatedBy);
        AddDomainEvent(new UserActivatedEvent(Id, Email.Value));
    }

    public void Lock(Guid lockedBy)
    {
        if (Status == UserStatus.Locked) return;

        Status = UserStatus.Locked;
        LockoutEndDate = DateTime.MaxValue;
        RevokeAllRefreshTokens("system", "User locked");

        MarkAsModified(lockedBy);
        AddDomainEvent(new UserLockedEvent(Id, Email.Value, DateTime.MaxValue));
    }

    public void Unlock(Guid unlockedBy)
    {
        if (Status != UserStatus.Locked && !LockedUntil.HasValue && !LockoutEndDate.HasValue) return;

        Status = UserStatus.Active;
        LockedUntil = null;
        LockoutEndDate = null;
        FailedLoginAttempts = 0;

        MarkAsModified(unlockedBy);
    }

    /// <summary>
    /// Checks if the user can add friends. Email verification is required.
    /// </summary>
    public bool CanAddFriends()
    {
        return IsEmailVerified && IsActive;
    }

    public void UpdateLastLogin()
    {
        LastLoginAt = DateTime.UtcNow;
        FailedLoginAttempts = 0;
        if (LockedUntil.HasValue && LockedUntil.Value < DateTime.UtcNow)
        {
            LockedUntil = null;
            LockoutEndDate = null;
            Status = UserStatus.Active;
        }
        MarkAsModified(Id);
    }

    public void ResetFailedLoginAttempts()
    {
        FailedLoginAttempts = 0;
    }
}

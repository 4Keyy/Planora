using Planora.Auth.Domain.Exceptions;

namespace Planora.Auth.Domain.Entities;

public sealed class LoginHistory : BaseEntity
{
    public Guid UserId { get; private set; }
    public string IpAddress { get; private set; }
    public string UserAgent { get; private set; }
    public bool IsSuccessful { get; private set; }
    public DateTime LoginAt { get; private set; }
    public string? FailureReason { get; private set; }

    // Navigation property
    public User User { get; private set; } = null!;

    private LoginHistory()
    {
        IpAddress = string.Empty;
        UserAgent = string.Empty;
    }

    public LoginHistory(Guid userId, string ipAddress, string userAgent, bool isSuccessful, string? failureReason = null)
    {
        if (userId == Guid.Empty)
            throw new AuthDomainException("User ID cannot be empty");
        if (string.IsNullOrWhiteSpace(ipAddress))
            throw new AuthDomainException("IP address cannot be empty");
        if (string.IsNullOrWhiteSpace(userAgent))
            throw new AuthDomainException("User agent cannot be empty");

        UserId = userId;
        IpAddress = ipAddress;
        UserAgent = userAgent;
        IsSuccessful = isSuccessful;
        FailureReason = failureReason;
        LoginAt = DateTime.UtcNow;
    }
}

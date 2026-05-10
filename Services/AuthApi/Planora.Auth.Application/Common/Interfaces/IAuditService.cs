namespace Planora.Auth.Application.Common.Interfaces
{
    public interface IAuditService
    {
        Task LogAuditEventAsync(
            Guid userId,
            string action,
            string details,
            string? ipAddress = null,
            CancellationToken cancellationToken = default);
    }
}

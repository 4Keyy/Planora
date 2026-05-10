using Planora.Auth.Infrastructure.Auditing;

namespace Planora.Auth.Infrastructure.Services.Common
{
    public sealed class AuditService : IAuditService
    {
        private readonly AuthDbContext _context;
        private readonly ILogger<AuditService> _logger;

        public AuditService(
            AuthDbContext context,
            ILogger<AuditService> logger)
        {
            _context = context;
            _logger = logger;
        }

        public async Task LogAuditEventAsync(
            Guid userId,
            string action,
            string details,
            string? ipAddress = null,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var auditLog = AuditLog.CreateEventLog(
                    action,
                    details,
                    userId,
                    ipAddress,
                    DetermineSeverity(action));

                _context.AuditLogs.Add(auditLog);
                await _context.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Audit log created: UserId={UserId}, Action={Action}",
                    userId,
                    action);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating audit log");
            }
        }

        private static string DetermineSeverity(string action)
        {
            var criticalActions = new[] { "DELETE_ACCOUNT", "DISABLE_2FA", "PASSWORD_RESET" };
            var warningActions = new[] { "FAILED_LOGIN", "INVALID_2FA", "SESSION_REVOKED" };

            if (criticalActions.Contains(action, StringComparer.OrdinalIgnoreCase))
                return "Critical";

            if (warningActions.Contains(action, StringComparer.OrdinalIgnoreCase))
                return "Warning";

            return "Info";
        }
    }
}

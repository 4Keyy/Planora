namespace Planora.Auth.Infrastructure.Auditing
{
    public sealed class AuditLog : BaseEntity
    {
        public string Action { get; private set; } = string.Empty;
        public string EntityName { get; private set; } = string.Empty;
        public Guid EntityId { get; private set; }
        public string? OldValues { get; private set; }
        public string? NewValues { get; private set; }
        public string? Details { get; private set; }
        public string? IpAddress { get; private set; }
        public string? Severity { get; private set; }

        // Constructor for entity-based audit logs
        public AuditLog(string action, string entityName, Guid entityId, string? oldValues, string? newValues)
        {
            Action = action;
            EntityName = entityName;
            EntityId = entityId;
            OldValues = oldValues;
            NewValues = newValues;
        }

        // Parameterless constructor for EF Core
        private AuditLog()
        {
        }

        // Factory method for event-based audit logs (used by AuditService)
        public static AuditLog CreateEventLog(string action, string details, Guid userId, string? ipAddress = null, string? severity = null)
        {
            return new AuditLog
            {
                Action = action,
                Details = details,
                EntityName = "User",
                EntityId = userId,
                IpAddress = ipAddress,
                Severity = severity
            };
        }
    }
}

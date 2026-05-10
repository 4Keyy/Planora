namespace Planora.Auth.Domain.Entities
{
    public sealed class PasswordHistory : BaseEntity
    {
        public Guid UserId { get; private set; }
        public string PasswordHash { get; private set; }
        public DateTime ChangedAt { get; private set; }

        private PasswordHistory()
        {
            PasswordHash = string.Empty;
        }

        public PasswordHistory(Guid userId, string passwordHash)
        {
            if (userId == Guid.Empty)
                throw new ArgumentException("User ID cannot be empty", nameof(userId));

            if (string.IsNullOrWhiteSpace(passwordHash))
                throw new ArgumentException("Password hash cannot be empty", nameof(passwordHash));

            UserId = userId;
            PasswordHash = passwordHash;
            ChangedAt = DateTime.UtcNow;
        }

        public bool IsOlderThan(int days)
        {
            return ChangedAt < DateTime.UtcNow.AddDays(-days);
        }
    }
}

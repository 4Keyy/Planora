namespace Planora.Auth.Domain.Entities
{
    public sealed class UserRecoveryCode : BaseEntity
    {
        public Guid UserId { get; private set; }
        public string CodeHash { get; private set; }
        public bool IsUsed { get; private set; }
        public DateTime? UsedAt { get; private set; }

        private UserRecoveryCode()
        {
            CodeHash = string.Empty;
        }

        public UserRecoveryCode(Guid userId, string codeHash)
        {
            if (userId == Guid.Empty)
                throw new ArgumentException("User ID cannot be empty", nameof(userId));
            if (string.IsNullOrWhiteSpace(codeHash))
                throw new ArgumentException("Code hash cannot be empty", nameof(codeHash));

            UserId = userId;
            CodeHash = codeHash;
            IsUsed = false;
        }

        public void MarkAsUsed()
        {
            IsUsed = true;
            UsedAt = DateTime.UtcNow;
            MarkAsModified(UserId);
        }
    }
}

using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public sealed class UserLockedException : AuthDomainException
    {
        public override ErrorCategory Category => ErrorCategory.Unauthorized;

        public UserLockedException(DateTime? lockedUntil)
            : base(
                lockedUntil.HasValue
                    ? $"User is locked until {lockedUntil.Value:yyyy-MM-dd HH:mm:ss} UTC"
                    : "User is permanently locked",
                Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.UserLocked,
                ErrorCategory.Unauthorized)
        {
            if (lockedUntil.HasValue)
                AddDetail("LockedUntil", lockedUntil.Value);
        }
    }
}

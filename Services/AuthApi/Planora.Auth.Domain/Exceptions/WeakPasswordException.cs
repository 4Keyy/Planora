using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public sealed class WeakPasswordException : AuthDomainException
    {
        public override ErrorCategory Category => ErrorCategory.Validation;

        public WeakPasswordException(string reason)
            : base($"Password is too weak: {reason}", Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.WeakPassword, ErrorCategory.Validation)
        {
            AddDetail("Reason", reason);
        }
    }
}

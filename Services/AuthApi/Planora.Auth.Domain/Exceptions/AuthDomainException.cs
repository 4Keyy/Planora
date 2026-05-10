using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public class AuthDomainException : DomainException
    {
        public override ErrorCategory Category => ErrorCategory.Unauthorized;

        public AuthDomainException(string message)
            : base(message, Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.InvalidToken, ErrorCategory.Unauthorized)
        {
        }

        public AuthDomainException(string message, string errorCode)
            : base(message, errorCode, ErrorCategory.Unauthorized)
        {
        }

        public AuthDomainException(string message, string errorCode, ErrorCategory category)
            : base(message, errorCode, category)
        {
        }
    }
}

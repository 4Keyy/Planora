using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public sealed class InvalidRefreshTokenException : AuthDomainException
    {
        public override ErrorCategory Category => ErrorCategory.Unauthorized;

        public InvalidRefreshTokenException(string reason)
            : base($"Refresh token is invalid: {reason}", Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.InvalidRefreshToken, ErrorCategory.Unauthorized)
        {
            AddDetail("Reason", reason);
        }
    }
}

using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public sealed class RefreshTokenNotFoundException : AuthDomainException
    {
        public override ErrorCategory Category => ErrorCategory.Unauthorized;

        public RefreshTokenNotFoundException()
            : base("Refresh token not found or expired", Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.RefreshTokenNotFound, ErrorCategory.Unauthorized)
        {
        }
    }
}

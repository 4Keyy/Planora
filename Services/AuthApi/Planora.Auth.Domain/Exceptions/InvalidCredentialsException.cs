using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public sealed class InvalidCredentialsException : AuthDomainException
    {
        public InvalidCredentialsException()
            : base("Invalid email or password", Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.InvalidCredentials, ErrorCategory.Unauthorized)
        {
        }
    }
}

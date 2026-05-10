using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public sealed class UserAlreadyExistsException : AuthDomainException
    {
        public override ErrorCategory Category => ErrorCategory.Conflict;

        public UserAlreadyExistsException(string email)
            : base($"User with email '{email}' already exists", Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.UserAlreadyExists, ErrorCategory.Conflict)
        {
            AddDetail("Email", email);
        }
    }
}

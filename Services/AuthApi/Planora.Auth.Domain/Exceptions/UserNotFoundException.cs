using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.Auth.Domain.Exceptions
{
    public sealed class UserNotFoundException : AuthDomainException
    {
        public override ErrorCategory Category => ErrorCategory.NotFound;

        public UserNotFoundException(Guid userId)
            : base($"User with ID '{userId}' was not found", Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.UserNotFound, ErrorCategory.NotFound)
        {
            AddDetail("UserId", userId);
        }

        public UserNotFoundException(string email)
            : base($"User with email '{email}' was not found", Planora.BuildingBlocks.Domain.Exceptions.ErrorCode.Auth.UserNotFound, ErrorCategory.NotFound)
        {
            AddDetail("Email", email);
        }
    }
}

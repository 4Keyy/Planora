namespace Planora.BuildingBlocks.Domain.Exceptions;

public class ForbiddenException : DomainException
{
    public override ErrorCategory Category => ErrorCategory.Forbidden;

    public ForbiddenException(string message, string errorCode = "AUTHORIZATION.FORBIDDEN")
        : base(message, errorCode, ErrorCategory.Forbidden)
    {
    }

    public ForbiddenException(string message, string errorCode, Exception innerException)
        : base(message, errorCode, ErrorCategory.Forbidden, innerException)
    {
    }
}
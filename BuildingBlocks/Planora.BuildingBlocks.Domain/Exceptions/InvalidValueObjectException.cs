namespace Planora.BuildingBlocks.Domain.Exceptions;

public class InvalidValueObjectException : DomainException
{
    public override ErrorCategory Category => ErrorCategory.Validation;

    public InvalidValueObjectException(string valueObjectName, string message, string errorCode = "VALIDATION.INVALID_INPUT")
        : base($"Invalid {valueObjectName}: {message}", errorCode, ErrorCategory.Validation)
    {
        AddDetail("ValueObjectType", valueObjectName);
    }
}
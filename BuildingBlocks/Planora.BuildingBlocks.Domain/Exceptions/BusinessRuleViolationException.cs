namespace Planora.BuildingBlocks.Domain.Exceptions;

public class BusinessRuleViolationException : DomainException
{
    public override ErrorCategory Category => ErrorCategory.Conflict;

    public BusinessRuleViolationException(string message, string errorCode = "BUSINESS.RULE_VIOLATION")
        : base(message, errorCode, ErrorCategory.Conflict)
    {
    }

    public BusinessRuleViolationException(string message, string errorCode, Exception innerException)
        : base(message, errorCode, ErrorCategory.Conflict, innerException)
    {
    }
}
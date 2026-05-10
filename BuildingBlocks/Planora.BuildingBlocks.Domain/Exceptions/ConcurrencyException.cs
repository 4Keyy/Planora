namespace Planora.BuildingBlocks.Domain.Exceptions;

public class ConcurrencyException : DomainException
{
    public override ErrorCategory Category => ErrorCategory.Conflict;

    public ConcurrencyException(string entityName, Guid entityId)
        : base($"{entityName} with ID '{entityId}' was modified by another user.", "CONCURRENCY.CONFLICT_ON_UPDATE", ErrorCategory.Conflict)
    {
        AddDetail("EntityType", entityName);
        AddDetail("EntityId", entityId);
    }

    public ConcurrencyException(string message, string errorCode = "CONCURRENCY.CONFLICT_ON_UPDATE")
        : base(message, errorCode, ErrorCategory.Conflict)
    {
    }
}
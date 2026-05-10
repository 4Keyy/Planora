namespace Planora.BuildingBlocks.Domain.Exceptions;

public class EntityNotFoundException : DomainException
{
    public override ErrorCategory Category => ErrorCategory.NotFound;

    public EntityNotFoundException(string entityName, Guid entityId)
        : base($"{entityName} with ID '{entityId}' was not found.", "NOT_FOUND.RESOURCE", ErrorCategory.NotFound)
    {
        AddDetail("EntityType", entityName);
        AddDetail("EntityId", entityId);
    }

    public EntityNotFoundException(string entityName, string identifier)
        : base($"{entityName} with identifier '{identifier}' was not found.", "NOT_FOUND.RESOURCE", ErrorCategory.NotFound)
    {
        AddDetail("EntityType", entityName);
        AddDetail("Identifier", identifier);
    }
}
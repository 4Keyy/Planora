namespace Planora.BuildingBlocks.Domain.Exceptions;

public class DuplicateEntityException : DomainException
{
    public override ErrorCategory Category => ErrorCategory.Conflict;

    public DuplicateEntityException(string entityName, string field, object value)
        : base($"{entityName} with {field} '{value}' already exists.", "BUSINESS.DUPLICATE_ENTITY", ErrorCategory.Conflict)
    {
        AddDetail("EntityType", entityName);
        AddDetail("Field", field);
        AddDetail("Value", value);
    }
}
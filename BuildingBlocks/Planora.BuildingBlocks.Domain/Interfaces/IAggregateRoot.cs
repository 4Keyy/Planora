namespace Planora.BuildingBlocks.Domain.Interfaces;

public interface IAggregateRoot
{
    Guid Id { get; }
    IReadOnlyCollection<IDomainEvent> DomainEvents { get; }
    void ClearDomainEvents();
}
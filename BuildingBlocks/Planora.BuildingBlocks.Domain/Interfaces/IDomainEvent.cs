namespace Planora.BuildingBlocks.Domain.Interfaces;

public interface IDomainEvent
{
    Guid EventId { get; }
    DateTime OccurredOn { get; }
    string EventType { get; }
}
namespace Planora.BuildingBlocks.Domain;

public abstract record DomainEvent : IDomainEvent
{
    public Guid EventId { get; init; }
    public DateTime OccurredOn { get; init; }
    public string EventType { get; init; }

    protected DomainEvent()
    {
        EventId = Guid.NewGuid();
        OccurredOn = DateTime.UtcNow;
        EventType = GetType().FullName ?? GetType().Name;
    }
}
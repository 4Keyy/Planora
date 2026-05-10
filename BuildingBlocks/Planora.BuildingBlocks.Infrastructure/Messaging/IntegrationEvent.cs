namespace Planora.BuildingBlocks.Infrastructure.Messaging;

public abstract class IntegrationEvent
{
    public Guid Id { get; init; }
    public DateTime OccurredOn { get; init; }

    protected IntegrationEvent()
    {
        Id = Guid.NewGuid();
        OccurredOn = DateTime.UtcNow;
    }

    protected IntegrationEvent(Guid id, DateTime occurredOn)
    {
        Id = id;
        OccurredOn = occurredOn;
    }
}
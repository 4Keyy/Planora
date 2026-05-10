namespace Planora.BuildingBlocks.Infrastructure.Inbox
{
    public interface IIdempotentMessageHandler
    {
        Task<bool> HandleAsync<TEvent>(TEvent @event, CancellationToken cancellationToken = default)
            where TEvent : IntegrationEvent;
    }
}

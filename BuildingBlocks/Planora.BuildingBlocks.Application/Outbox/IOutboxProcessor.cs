namespace Planora.BuildingBlocks.Application.Outbox
{
    public interface IOutboxProcessor
    {
        Task ProcessPendingMessagesAsync(CancellationToken cancellationToken = default);
    }
}

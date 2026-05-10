namespace Planora.BuildingBlocks.Infrastructure.Outbox
{
    public interface IOutboxRepository
    {
        Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default);
        Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default);
        Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default);
    }
}

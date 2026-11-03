namespace Planora.BuildingBlocks.Application.Outbox
{
    public interface IOutboxRepository
    {
        /// <summary>
        /// Tracks a message in the owner's scoped DbContext without saving or publishing.
        /// The owner must save the business mutation and all staged messages together.
        /// </summary>
        Task StageAsync(OutboxMessage message, CancellationToken cancellationToken = default);

        /// <summary>Saves immediately, including other pending changes in the same DbContext.</summary>
        Task AddAsync(OutboxMessage message, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<OutboxMessage>> GetPendingMessagesAsync(int batchSize, CancellationToken cancellationToken = default);
        Task UpdateAsync(OutboxMessage message, CancellationToken cancellationToken = default);
        Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default);
    }
}

namespace Planora.BuildingBlocks.Infrastructure.Inbox
{
    public interface IInboxRepository
    {
        Task<InboxMessage?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);
        Task AddAsync(InboxMessage message, CancellationToken cancellationToken = default);
        Task UpdateAsync(InboxMessage message, CancellationToken cancellationToken = default);
        Task<bool> ExistsAsync(Guid id, CancellationToken cancellationToken = default);
        Task DeleteProcessedMessagesAsync(DateTime olderThan, CancellationToken cancellationToken = default);
    }
}

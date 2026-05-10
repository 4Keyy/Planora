using Planora.Messaging.Domain.Entities;

namespace Planora.Messaging.Domain
{
    public interface IMessageRepository : IRepository<Message>
    {
        Task<IReadOnlyList<Message>> GetSentByUserAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<Message>> GetReceivedByUserAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<Message>> GetConversationAsync(Guid userId1, Guid userId2, CancellationToken cancellationToken = default);
        Task<(IReadOnlyList<Message> Items, int TotalCount)> GetConversationPagedAsync(Guid userId1, Guid userId2, int page, int pageSize, CancellationToken cancellationToken = default);
        Task<int> GetUnreadCountAsync(Guid recipientId, CancellationToken cancellationToken = default);
    }
}

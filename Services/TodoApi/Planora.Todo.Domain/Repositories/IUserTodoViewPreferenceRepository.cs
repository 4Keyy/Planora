using Planora.Todo.Domain.Entities;

namespace Planora.Todo.Domain.Repositories
{
    public interface IUserTodoViewPreferenceRepository
    {
        Task<List<Guid>> GetHiddenTodoIdsAsync(Guid viewerId, CancellationToken cancellationToken = default);
        Task<List<Guid>> GetCompletedTodoIdsByViewerAsync(Guid viewerId, CancellationToken cancellationToken = default);
        Task<IReadOnlyDictionary<Guid, UserTodoViewPreference>> GetByViewerIdAsync(Guid viewerId, CancellationToken cancellationToken = default);
        Task<IReadOnlyDictionary<Guid, UserTodoViewPreference>> GetByViewerIdForTodosAsync(
            Guid viewerId,
            IReadOnlyCollection<Guid> todoItemIds,
            CancellationToken cancellationToken = default);
        Task<List<Guid>> GetTodoIdsByViewerCategoryAsync(Guid viewerId, Guid categoryId, CancellationToken cancellationToken = default);
        Task<UserTodoViewPreference?> GetAsync(Guid viewerId, Guid todoItemId, CancellationToken cancellationToken = default);
        Task UpsertAsync(UserTodoViewPreference preference, CancellationToken cancellationToken = default);
    }
}

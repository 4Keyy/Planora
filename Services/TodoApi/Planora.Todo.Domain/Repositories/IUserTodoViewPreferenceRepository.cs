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

        /// <summary>
        /// The set of viewers who have marked this task complete (per-viewer completion). Used to
        /// detect when every collaborator except the author has finished, which drives the
        /// "ready for review" / "all participants done" author notifications.
        /// </summary>
        Task<HashSet<Guid>> GetCompletedViewerIdsForTodoAsync(Guid todoItemId, CancellationToken cancellationToken = default);

        /// <summary>
        /// Bulk-clears every viewer's per-viewer completion (<c>CompletedByViewer = false</c>,
        /// <c>CompletedByViewerAt = null</c>) for one task in a single SQL UPDATE. Used when the
        /// author reopens an audience (public/shared) task so it becomes active for everyone again.
        /// Returns the number of rows reset.
        /// </summary>
        Task<int> ClearCompletedByViewerForTodoAsync(Guid todoItemId, CancellationToken cancellationToken = default);

        Task UpsertAsync(UserTodoViewPreference preference, CancellationToken cancellationToken = default);
    }
}

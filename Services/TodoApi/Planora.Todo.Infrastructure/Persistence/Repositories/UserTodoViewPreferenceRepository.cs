using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Microsoft.EntityFrameworkCore;

namespace Planora.Todo.Infrastructure.Persistence.Repositories
{
    public sealed class UserTodoViewPreferenceRepository : IUserTodoViewPreferenceRepository
    {
        private readonly TodoDbContext _context;

        public UserTodoViewPreferenceRepository(TodoDbContext context)
        {
            _context = context;
        }

        public async Task<List<Guid>> GetHiddenTodoIdsAsync(Guid viewerId, CancellationToken cancellationToken = default)
        {
            return await _context.UserTodoViewPreferences
                .Where(p => p.ViewerId == viewerId && p.HiddenByViewer)
                .Select(p => p.TodoItemId)
                .ToListAsync(cancellationToken);
        }

        public async Task<List<Guid>> GetCompletedTodoIdsByViewerAsync(Guid viewerId, CancellationToken cancellationToken = default)
        {
            return await _context.UserTodoViewPreferences
                .Where(p => p.ViewerId == viewerId && p.CompletedByViewer)
                .Select(p => p.TodoItemId)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyDictionary<Guid, UserTodoViewPreference>> GetByViewerIdAsync(Guid viewerId, CancellationToken cancellationToken = default)
        {
            return await _context.UserTodoViewPreferences
                .Where(p => p.ViewerId == viewerId)
                .ToDictionaryAsync(p => p.TodoItemId, cancellationToken);
        }

        public async Task<IReadOnlyDictionary<Guid, UserTodoViewPreference>> GetByViewerIdForTodosAsync(
            Guid viewerId,
            IReadOnlyCollection<Guid> todoItemIds,
            CancellationToken cancellationToken = default)
        {
            if (todoItemIds.Count == 0)
                return new Dictionary<Guid, UserTodoViewPreference>();

            return await _context.UserTodoViewPreferences
                .Where(p => p.ViewerId == viewerId && todoItemIds.Contains(p.TodoItemId))
                .ToDictionaryAsync(p => p.TodoItemId, cancellationToken);
        }

        public async Task<List<Guid>> GetTodoIdsByViewerCategoryAsync(
            Guid viewerId,
            Guid categoryId,
            CancellationToken cancellationToken = default)
        {
            return await _context.UserTodoViewPreferences
                .Where(p => p.ViewerId == viewerId && p.ViewerCategoryId == categoryId)
                .Select(p => p.TodoItemId)
                .ToListAsync(cancellationToken);
        }

        public async Task<UserTodoViewPreference?> GetAsync(Guid viewerId, Guid todoItemId, CancellationToken cancellationToken = default)
        {
            return await _context.UserTodoViewPreferences
                .FirstOrDefaultAsync(
                    p => p.ViewerId == viewerId && p.TodoItemId == todoItemId,
                    cancellationToken);
        }

        public async Task<HashSet<Guid>> GetCompletedViewerIdsForTodoAsync(Guid todoItemId, CancellationToken cancellationToken = default)
        {
            var ids = await _context.UserTodoViewPreferences
                .AsNoTracking()
                .Where(p => p.TodoItemId == todoItemId && p.CompletedByViewer)
                .Select(p => p.ViewerId)
                .ToListAsync(cancellationToken);
            return new HashSet<Guid>(ids);
        }

        public async Task<int> ClearCompletedByViewerForTodoAsync(Guid todoItemId, CancellationToken cancellationToken = default)
        {
            // One set-based UPDATE resets all viewers' completion for this task. The owner-reopen path
            // does not load these preference rows into the tracker, so a bulk ExecuteUpdate is safe and
            // avoids materialising N rows just to flip a flag.
            return await _context.UserTodoViewPreferences
                .Where(p => p.TodoItemId == todoItemId && p.CompletedByViewer)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(p => p.CompletedByViewer, false)
                    .SetProperty(p => p.CompletedByViewerAt, (DateTime?)null),
                    cancellationToken);
        }

        public async Task UpsertAsync(UserTodoViewPreference preference, CancellationToken cancellationToken = default)
        {
            // Check for a tracked instance first to avoid detached-entity conflicts
            var trackedEntry = _context.ChangeTracker
                .Entries<UserTodoViewPreference>()
                .FirstOrDefault(e =>
                    e.Entity.ViewerId == preference.ViewerId &&
                    e.Entity.TodoItemId == preference.TodoItemId);

            if (trackedEntry is not null)
            {
                trackedEntry.Entity.HiddenByViewer = preference.HiddenByViewer;
                trackedEntry.Entity.ViewerCategoryId = preference.ViewerCategoryId;
                trackedEntry.Entity.CompletedByViewer = preference.CompletedByViewer;
                trackedEntry.Entity.CompletedByViewerAt = preference.CompletedByViewerAt;
                trackedEntry.State = EntityState.Modified;
                return;
            }

            var existing = await _context.UserTodoViewPreferences
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    p => p.ViewerId == preference.ViewerId && p.TodoItemId == preference.TodoItemId,
                    cancellationToken);

            if (existing is null)
                _context.UserTodoViewPreferences.Add(preference);
            else
                _context.UserTodoViewPreferences.Update(preference);
        }
    }
}

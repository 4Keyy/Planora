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

        public async Task UpsertAsync(UserTodoViewPreference preference, CancellationToken cancellationToken = default)
        {
            var existing = await GetAsync(preference.ViewerId, preference.TodoItemId, cancellationToken);

            if (existing is null)
            {
                _context.UserTodoViewPreferences.Add(preference);
                return;
            }

            existing.HiddenByViewer = preference.HiddenByViewer;
            existing.ViewerCategoryId = preference.ViewerCategoryId;
            _context.UserTodoViewPreferences.Update(existing);
        }
    }
}

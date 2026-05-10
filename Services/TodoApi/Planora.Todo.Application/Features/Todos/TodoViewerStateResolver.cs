using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Application.Features.Todos;

internal static class TodoViewerStateResolver
{
    public static bool HasSharedAudience(TodoItem todo) =>
        todo.IsPublic || todo.SharedWith.Any();

    public static bool IsVisuallyUrgent(TodoItem todo, DateTime? now = null)
    {
        if (todo.IsCompleted)
            return false;

        if (todo.Priority is TodoPriority.Urgent)
            return true;

        return todo.DueDate.HasValue && todo.DueDate.Value.Date <= (now ?? DateTime.UtcNow).Date;
    }

    public static bool IsSharedWithViewer(TodoItem todo, Guid viewerId) =>
        todo.UserId != viewerId && todo.SharedWith.Any(s => s.SharedWithUserId == viewerId);

    public static bool GetEffectiveHidden(
        TodoItem todo,
        Guid viewerId,
        UserTodoViewPreference? preference)
    {
        if (!HasSharedAudience(todo))
            return todo.Hidden;

        if (todo.UserId == viewerId)
        {
            // Keep backward compatibility for legacy shared todos that were hidden globally
            // before viewer-specific preferences were introduced.
            return (preference?.HiddenByViewer ?? false) || todo.Hidden;
        }

        return preference?.HiddenByViewer ?? false;
    }

    public static Guid? GetEffectiveCategoryId(
        TodoItem todo,
        Guid viewerId,
        UserTodoViewPreference? preference)
    {
        if (!HasSharedAudience(todo))
            return todo.CategoryId;

        if (todo.UserId == viewerId)
            return todo.CategoryId;

        return preference?.ViewerCategoryId;
    }
}

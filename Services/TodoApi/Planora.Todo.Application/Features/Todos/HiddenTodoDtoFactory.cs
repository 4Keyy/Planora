using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Domain.Entities;

namespace Planora.Todo.Application.Features.Todos;

internal static class HiddenTodoDtoFactory
{
    public static bool ShouldMask(TodoItem todo, Guid viewerId, bool effectiveHidden) =>
        effectiveHidden && (todo.UserId != viewerId || TodoViewerStateResolver.HasSharedAudience(todo));

    public static TodoItemDto CreateMasked(
        TodoItem todo,
        Guid viewerId,
        Guid? viewerCategoryId,
        CategoryInfo? viewerCategory)
    {
        var isOwner = todo.UserId == viewerId;

        return new TodoItemDto
        {
            Id = todo.Id,
            UserId = isOwner ? todo.UserId : Guid.Empty,
            Title = "Hidden task",
            Hidden = true,
            Status = string.Empty,
            Priority = todo.Priority.ToString(),
            IsPublic = todo.IsPublic,
            IsCompleted = false,
            Tags = Array.Empty<string>(),
            CreatedAt = DateTime.MinValue,
            SharedWithUserIds = Array.Empty<Guid>(),
            HasSharedAudience = TodoViewerStateResolver.HasSharedAudience(todo),
            IsVisuallyUrgent = TodoViewerStateResolver.IsVisuallyUrgent(todo),
            CategoryId = viewerCategoryId,
            CategoryName = viewerCategory?.Name,
            CategoryColor = viewerCategory?.Color,
            CategoryIcon = viewerCategory?.Icon,
        };
    }
}

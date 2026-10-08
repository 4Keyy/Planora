using System.Linq.Expressions;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;

namespace Planora.Todo.Application.Common;

/// <summary>The same access rule for runtime guards and SQL: live friendship AND a stored share,
/// with the dynamic All friends fallback restricted to public rows not yet backfilled.</summary>
public static class TodoAccessPolicy
{
    public static bool HasFriendVisibility(TodoItem todo, Guid viewerId) =>
        todo.SharedWith.Any(share => share.SharedWithUserId == viewerId) ||
        (todo.IsPublic && todo.AllFriendsSnapshotAt == null);

    public static async Task<bool> CanAccessAsync(TodoItem todo, Guid viewerId,
        IFriendshipService friendshipService, CancellationToken cancellationToken) =>
        todo.UserId == viewerId || (HasFriendVisibility(todo, viewerId) &&
            await friendshipService.AreFriendsAsync(viewerId, todo.UserId, cancellationToken));

    public static Expression<Func<TodoItem, bool>> VisibleTo(Guid viewerId, IReadOnlyCollection<Guid> currentFriendIds) =>
        todo => todo.UserId == viewerId || (currentFriendIds.Contains(todo.UserId) &&
            (todo.SharedWith.Any(share => share.SharedWithUserId == viewerId) ||
             (todo.IsPublic && todo.AllFriendsSnapshotAt == null)));

    // Inline parameters instead of Expression.Invoke, so EF translates the composed predicate.
    public static Expression<Func<TodoItem, bool>> And(Expression<Func<TodoItem, bool>> left,
        Expression<Func<TodoItem, bool>> right)
    {
        var body = new ParameterReplacement(right.Parameters[0], left.Parameters[0]).Visit(right.Body)!;
        return Expression.Lambda<Func<TodoItem, bool>>(Expression.AndAlso(left.Body, body), left.Parameters);
    }

    public static TodoItemDto RedactAudience(TodoItem todo, Guid viewerId, TodoItemDto dto) =>
        todo.IsPublic && todo.UserId != viewerId ? dto with { SharedWithUserIds = Array.Empty<Guid>() } : dto;

    private sealed class ParameterReplacement(ParameterExpression from, ParameterExpression to) : ExpressionVisitor
    {
        protected override Expression VisitParameter(ParameterExpression node) => node == from ? to : base.VisitParameter(node);
    }
}

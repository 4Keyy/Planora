using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Domain.Events
{
    public sealed record TodoCommentAddedDomainEvent(
        Guid CommentId,
        Guid TodoItemId,
        Guid AuthorId) : DomainEvent;
}

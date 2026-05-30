using Planora.BuildingBlocks.Domain;

namespace Planora.Collaboration.Domain.Events
{
    public sealed record CommentAddedDomainEvent(
        Guid CommentId,
        Guid TaskId,
        Guid AuthorId) : DomainEvent;
}

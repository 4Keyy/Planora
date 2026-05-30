using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;

namespace Planora.Collaboration.Application.Features.Comments.Commands.DeleteComment
{
    public sealed record DeleteCommentCommand(Guid TaskId, Guid CommentId) : ICommand<Result>;
}

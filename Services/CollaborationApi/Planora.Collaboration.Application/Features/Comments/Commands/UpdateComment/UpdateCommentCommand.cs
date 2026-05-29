using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;
using Planora.Collaboration.Application.DTOs;

namespace Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment
{
    public sealed record UpdateCommentCommand(Guid TaskId, Guid CommentId, string Content) : ICommand<Result<CommentDto>>;
}

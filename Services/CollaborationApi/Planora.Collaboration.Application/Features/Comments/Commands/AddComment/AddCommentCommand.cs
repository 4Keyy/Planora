using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;
using Planora.Collaboration.Application.DTOs;

namespace Planora.Collaboration.Application.Features.Comments.Commands.AddComment
{
    public sealed record AddCommentCommand(Guid TaskId, string Content) : ICommand<Result<CommentDto>>;
}

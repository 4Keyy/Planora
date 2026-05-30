using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;
using Planora.Collaboration.Application.DTOs;

namespace Planora.Collaboration.Application.Features.Comments.Commands.AddGenesisComment
{
    public sealed record AddGenesisCommentCommand(Guid TaskId, string Content) : ICommand<Result<CommentDto>>;
}

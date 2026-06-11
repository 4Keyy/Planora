using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;
using Planora.Collaboration.Application.DTOs;

namespace Planora.Collaboration.Application.Features.Comments.Commands.AddComment
{
    /// <summary>
    /// Adds a comment to a task branch. When <paramref name="ReplyToType"/> +
    /// <paramref name="ReplyToId"/> are provided the comment is a reply quoting another
    /// comment/reply ("comment") or a subtask ("subtask"). The target is validated
    /// server-side; the quoted snapshot is never taken from the client.
    /// </summary>
    public sealed record AddCommentCommand(
        Guid TaskId,
        string Content,
        string? ReplyToType = null,
        Guid? ReplyToId = null) : ICommand<Result<CommentDto>>;
}

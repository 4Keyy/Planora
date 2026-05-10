using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Application.Features.Todos.Commands.DeleteComment
{
    public sealed record DeleteCommentCommand(Guid TodoId, Guid CommentId) : ICommand<Result>;
}

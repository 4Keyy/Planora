using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Commands.UpdateComment
{
    public sealed record UpdateCommentCommand(Guid TodoId, Guid CommentId, string Content) : ICommand<Result<TodoCommentDto>>;
}

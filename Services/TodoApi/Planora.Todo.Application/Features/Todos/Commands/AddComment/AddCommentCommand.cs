using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Commands.AddComment
{
    public sealed record AddCommentCommand(Guid TodoId, string Content) : ICommand<Result<TodoCommentDto>>;
}

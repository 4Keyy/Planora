using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Commands.AddGenesisComment
{
    public sealed record AddGenesisCommentCommand(Guid TodoId, string Content) : ICommand<Result<TodoCommentDto>>;
}

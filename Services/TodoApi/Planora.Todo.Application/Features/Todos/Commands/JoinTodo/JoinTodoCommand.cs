using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Commands.JoinTodo
{
    public sealed record JoinTodoCommand(Guid TodoId) : ICommand<Result<TodoItemDto>>;
}

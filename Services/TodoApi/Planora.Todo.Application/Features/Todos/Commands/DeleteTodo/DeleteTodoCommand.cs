using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Application.Features.Todos.Commands.DeleteTodo
{
    public sealed record DeleteTodoCommand(Guid TodoId) : ICommand<Result>;
}

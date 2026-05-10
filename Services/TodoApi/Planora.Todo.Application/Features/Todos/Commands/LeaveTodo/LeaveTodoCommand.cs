using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Application.Features.Todos.Commands.LeaveTodo
{
    public sealed record LeaveTodoCommand(Guid TodoId) : ICommand<Result>;
}

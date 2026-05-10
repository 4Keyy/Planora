using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;
using MediatR;

namespace Planora.Todo.Application.Features.Todos.Commands.SetTodoHidden
{
    public sealed record SetTodoHiddenCommand(Guid TodoId, bool Hidden) : IRequest<Result<TodoHiddenResponseDto>>;
}

using Planora.BuildingBlocks.Domain;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetTodoById;

public sealed record GetTodoByIdQuery(Guid TodoId) : IQuery<Result<TodoItemDto>>;

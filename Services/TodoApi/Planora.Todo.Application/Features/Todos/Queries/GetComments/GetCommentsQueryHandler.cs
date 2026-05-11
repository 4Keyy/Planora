using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Queries.GetComments
{
    public sealed class GetCommentsQueryHandler
        : IQueryHandler<GetCommentsQuery, Result<PagedResult<TodoCommentDto>>>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly ITodoCommentRepository _commentRepository;
        private readonly ICurrentUserContext _currentUserContext;

        public GetCommentsQueryHandler(
            ITodoRepository todoRepository,
            ITodoCommentRepository commentRepository,
            ICurrentUserContext currentUserContext)
        {
            _todoRepository = todoRepository;
            _commentRepository = commentRepository;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result<PagedResult<TodoCommentDto>>> Handle(
            GetCommentsQuery request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                return Result<PagedResult<TodoCommentDto>>.Failure(
                    new Error("AUTH_REQUIRED", "User context is not available"));

            var todoItem = await _todoRepository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            var isOwner = todoItem.UserId == userId;
            var hasAccess = isOwner ||
                todoItem.IsPublic ||
                todoItem.SharedWith.Any(s => s.SharedWithUserId == userId);

            if (!hasAccess)
                throw new ForbiddenException("You do not have access to this task");

            var (items, totalCount) = await _commentRepository.GetPagedByTodoIdAsync(
                request.TodoId, request.PageNumber, request.PageSize, cancellationToken);

            var dtos = items.Select(c => new TodoCommentDto(
                c.Id,
                c.TodoItemId,
                c.AuthorId,
                c.AuthorName,
                c.Content,
                c.CreatedAt,
                c.UpdatedAt,
                IsOwn: c.AuthorId == userId,
                IsEdited: c.IsEdited)).ToList();

            return Result<PagedResult<TodoCommentDto>>.Success(
                new PagedResult<TodoCommentDto>(dtos, request.PageNumber, request.PageSize, totalCount));
        }
    }
}

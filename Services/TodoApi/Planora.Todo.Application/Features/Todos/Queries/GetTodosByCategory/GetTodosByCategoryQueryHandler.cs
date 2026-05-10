using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;

namespace Planora.Todo.Application.Features.Todos.Queries.GetTodosByCategory
{
    public sealed class GetTodosByCategoryQueryHandler : IRequestHandler<GetTodosByCategoryQuery, Result<PagedResult<TodoItemDto>>>
    {
        private readonly IRepository<TodoItem> _repository;
        private readonly IMapper _mapper;
        private readonly ILogger<GetTodosByCategoryQueryHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;

        public GetTodosByCategoryQueryHandler(
            IRepository<TodoItem> repository,
            IMapper mapper,
            ILogger<GetTodosByCategoryQueryHandler> logger,
            ICurrentUserContext currentUserContext)
        {
            _repository = repository;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result<PagedResult<TodoItemDto>>> Handle(GetTodosByCategoryQuery request, CancellationToken cancellationToken)
        {
            var userId = request.UserId ?? _currentUserContext.UserId;
            if (userId == Guid.Empty)
                return Result<PagedResult<TodoItemDto>>.Failure(new Error("AUTH_REQUIRED", "User context is not available"));

            try
            {
                var (items, totalCount) = await _repository.GetPagedAsync(
                    request.PageNumber,
                    request.PageSize,
                    t => t.UserId == userId && t.CategoryId == request.CategoryId && !t.IsDeleted,
                    t => t.CreatedAt,
                    false,
                    cancellationToken);

                var dtos = items.Select(i => _mapper.Map<TodoItemDto>(i)).ToList();
                var pagedResult = new PagedResult<TodoItemDto>(dtos, request.PageNumber, request.PageSize, totalCount);

                return Result<PagedResult<TodoItemDto>>.Success(pagedResult);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get todos by category");
                return Result<PagedResult<TodoItemDto>>.Failure(new Error("QUERY_FAILED", ex.Message));
            }
        }
    }
}

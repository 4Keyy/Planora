using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Services;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Todo.Application.Features.Todos.Commands.CreateTodo
{
    public sealed class CreateTodoCommandHandler : IRequestHandler<CreateTodoCommand, Result<TodoItemDto>>
    {
        private readonly IRepository<TodoItem> _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IMapper _mapper;
        private readonly ILogger<CreateTodoCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IFriendshipService _friendshipService;
        private readonly IBusinessEventLogger? _businessLogger;

        public CreateTodoCommandHandler(
            IRepository<TodoItem> repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ILogger<CreateTodoCommandHandler> logger,
            ICurrentUserContext currentUserContext,
            ICategoryGrpcClient categoryGrpcClient,
            IFriendshipService friendshipService,
            IBusinessEventLogger? businessLogger = null)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
            _categoryGrpcClient = categoryGrpcClient;
            _friendshipService = friendshipService;
            _businessLogger = businessLogger;
        }

        public async Task<Result<TodoItemDto>> Handle(
            CreateTodoCommand request,
            CancellationToken cancellationToken)
        {
            var userId = request.UserId ?? _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var sharedWith = request.SharedWithUserIds?
                .Where(id => id != Guid.Empty && id != userId)
                .Distinct()
                .ToList() ?? new List<Guid>();

            if (sharedWith.Count > 0)
            {
                var friendIds = await _friendshipService.GetFriendIdsAsync(userId, cancellationToken);
                var allowed = new HashSet<Guid>(friendIds);
                if (sharedWith.Any(id => !allowed.Contains(id)))
                    throw new ForbiddenException("You can only share tasks with accepted friends");
            }

            var categoryId = request.CategoryId == Guid.Empty ? null : request.CategoryId;
            CategoryInfo? categoryInfo = null;
            if (categoryId.HasValue)
            {
                categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                    categoryId.Value,
                    userId,
                    cancellationToken);

                if (categoryInfo is null)
                    throw new ForbiddenException("Category does not belong to the current user");
            }

            var todoItem = TodoItem.Create(
                    userId,
                    request.Title,
                    request.Description,
                    categoryId,
                    request.DueDate,
                    request.ExpectedDate,
                    request.Priority,
                    request.IsPublic,
                    sharedWith);

            await _repository.AddAsync(todoItem, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Todo item created: {TodoId} by user {UserId}",
                todoItem.Id,
                userId);

            if (_businessLogger is not null)
            {
                var existingTodoCount = await TryCountUserTodosAsync(userId, cancellationToken);
                if (existingTodoCount <= 1)
                {
                    _businessLogger.LogBusinessEvent(
                        FirstTaskCreated,
                        $"User {userId} created their first task",
                        new { TodoId = todoItem.Id, CategoryId = categoryId },
                        userId.ToString());
                }

                if (sharedWith.Count > 0)
                {
                    _businessLogger.LogBusinessEvent(
                        TodoShared,
                        $"Todo {todoItem.Id} shared by user {userId}",
                        new { TodoId = todoItem.Id, SharedWithCount = sharedWith.Count },
                        userId.ToString());
                }
            }

            var dto = _mapper.Map<TodoItemDto>(todoItem);
            if (categoryInfo is not null)
            {
                dto = dto with
                {
                    CategoryName = categoryInfo.Name,
                    CategoryColor = categoryInfo.Color,
                    CategoryIcon = categoryInfo.Icon
                };
            }

            return Result<TodoItemDto>.Success(dto);
        }

        private async Task<int> TryCountUserTodosAsync(Guid userId, CancellationToken cancellationToken)
        {
            try
            {
                return await _repository.CountAsync(
                    todo => todo.UserId == userId && !todo.IsDeleted,
                    cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Could not count todos for first-task analytics event");
                return int.MaxValue;
            }
        }
    }
}

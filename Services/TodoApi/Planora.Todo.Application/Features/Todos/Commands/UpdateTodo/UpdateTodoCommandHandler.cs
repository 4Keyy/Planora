using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Services;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Domain.ValueObjects;
using MediatR;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Todo.Application.Features.Todos.Commands.UpdateTodo
{
    public sealed class UpdateTodoCommandHandler : IRequestHandler<UpdateTodoCommand, Result<TodoItemDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IMapper _mapper;
        private readonly ILogger<UpdateTodoCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IFriendshipService _friendshipService;
        private readonly IBusinessEventLogger? _businessLogger;

        public UpdateTodoCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ILogger<UpdateTodoCommandHandler> logger,
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
            UpdateTodoCommand request,
            CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var todoItem = await _repository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            var isOwner = todoItem.UserId == userId;
            var hasFriendVisibleAccess = !isOwner &&
                (todoItem.IsPublic || todoItem.SharedWith.Any(s => s.SharedWithUserId == userId));
            if (hasFriendVisibleAccess)
            {
                hasFriendVisibleAccess = await _friendshipService.AreFriendsAsync(userId, todoItem.UserId, cancellationToken);
            }

            if (!isOwner && !hasFriendVisibleAccess)
                throw new ForbiddenException("You can only update your own todo items or friend-visible tasks");

            // If it's not the owner, only allow status changes
            if (!isOwner)
            {
                // Check if trying to modify anything other than status
                if (request.Title != null || request.Description != null || request.CategoryId != null ||
                    request.DueDate != null || request.ExpectedDate != null || request.ActualDate != null ||
                    request.Priority.HasValue || request.IsPublic.HasValue || request.SharedWithUserIds != null ||
                    request.RequiredWorkers.HasValue || request.ClearRequiredWorkers)
                {
                    throw new ForbiddenException("You can only mark friend-visible tasks as complete, not edit them");
                }
            }

            if (!string.IsNullOrEmpty(request.Title))
                todoItem.UpdateTitle(request.Title, userId);

            if (request.Description != null)
                todoItem.UpdateDescription(request.Description, userId);

            CategoryInfo? categoryInfo = null;
            if (request.CategoryId.HasValue)
            {
                var requestedCategoryId = request.CategoryId.Value == Guid.Empty
                    ? (Guid?)null
                    : request.CategoryId.Value;

                if (requestedCategoryId.HasValue)
                {
                    categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                        requestedCategoryId.Value,
                        userId,
                        cancellationToken);

                    if (categoryInfo is null)
                        throw new ForbiddenException("Category does not belong to the current user");
                }

                todoItem.UpdateCategory(requestedCategoryId, userId);
            }

            if (request.DueDate != null)
                todoItem.UpdateDueDate(request.DueDate, userId);

            if (request.ExpectedDate != null)
                todoItem.UpdateExpectedDate(request.ExpectedDate, userId);

            if (request.ActualDate != null)
                todoItem.UpdateActualDate(request.ActualDate, userId);

            if (request.Priority.HasValue)
                todoItem.UpdatePriority(request.Priority.Value, userId);

            if (request.SharedWithUserIds != null)
            {
                var sharedWith = request.SharedWithUserIds
                    .Where(id => id != Guid.Empty && id != userId)
                    .Distinct()
                    .ToList();

                if (sharedWith.Count > 0)
                {
                    var friendIds = await _friendshipService.GetFriendIdsAsync(userId, cancellationToken);
                    var allowed = new HashSet<Guid>(friendIds);
                    if (sharedWith.Any(id => !allowed.Contains(id)))
                        throw new ForbiddenException("You can only share tasks with accepted friends");
                }

                todoItem.SetSharedWith(sharedWith, userId);
            }

            if (request.IsPublic.HasValue)
            {
                todoItem.SetPublic(request.IsPublic.Value, userId);
            }

            if (request.ClearRequiredWorkers)
                todoItem.SetRequiredWorkers(null, userId);
            else if (request.RequiredWorkers.HasValue)
                todoItem.SetRequiredWorkers(request.RequiredWorkers.Value, userId);

            if (!string.IsNullOrEmpty(request.Status))
            {
                var status = TodoStatusExtensions.FromString(request.Status);
                if (status.HasValue)
                {
                    if (status == TodoStatus.Done && !todoItem.IsCompleted)
                        todoItem.MarkAsDone(userId);
                    else if (status == TodoStatus.InProgress && todoItem.Status != TodoStatus.InProgress)
                        todoItem.MarkAsInProgress(userId);
                    else if (status == TodoStatus.Todo && todoItem.Status != TodoStatus.Todo)
                        todoItem.MarkAsTodo(userId);
                }
            }

            _repository.Update(todoItem);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            if (_businessLogger is not null && request.SharedWithUserIds is not null && todoItem.SharedWith.Any())
            {
                _businessLogger.LogBusinessEvent(
                    TodoShared,
                    $"Todo {todoItem.Id} sharing changed by user {userId}",
                    new { TodoId = todoItem.Id, SharedWithCount = todoItem.SharedWith.Count },
                    userId.ToString());
            }

            _logger.LogInformation("Todo item updated: {TodoId} by user {UserId}", request.TodoId, userId);

            var dto = _mapper.Map<TodoItemDto>(todoItem) with
            {
                WorkerCount = todoItem.Workers.Count,
                WorkerUserIds = todoItem.Workers.Select(w => w.UserId).ToList(),
                RequiredWorkers = todoItem.RequiredWorkers,
                IsWorking = todoItem.UserId != userId && todoItem.Workers.Any(w => w.UserId == userId),
            };

            if (!isOwner)
            {
                return Result<TodoItemDto>.Success(dto with
                {
                    CategoryId = null,
                    CategoryName = null,
                    CategoryColor = null,
                    CategoryIcon = null
                });
            }

            if (todoItem.CategoryId.HasValue)
            {
                try
                {
                    categoryInfo ??= await _categoryGrpcClient.GetCategoryInfoAsync(
                        todoItem.CategoryId.Value,
                        userId,
                        cancellationToken);

                    if (categoryInfo is not null)
                    {
                        dto = dto with
                        {
                            CategoryName = categoryInfo.Name,
                            CategoryColor = categoryInfo.Color,
                            CategoryIcon = categoryInfo.Icon
                        };
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex,
                        "Could not enrich updated todo with category data for {CategoryId}",
                        todoItem.CategoryId.Value);
                }
            }

            return Result<TodoItemDto>.Success(dto);
        }
    }
}

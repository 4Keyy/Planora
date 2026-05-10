using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Features.Todos;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Domain.ValueObjects;

namespace Planora.Todo.Application.Features.Todos.Queries.GetTodoById;

public sealed class GetTodoByIdQueryHandler : IQueryHandler<GetTodoByIdQuery, Result<TodoItemDto>>
{
    private readonly ITodoRepository _repository;
    private readonly ICurrentUserContext _currentUserContext;
    private readonly IMapper _mapper;
    private readonly ILogger<GetTodoByIdQueryHandler> _logger;
    private readonly IFriendshipService _friendshipService;
    private readonly ICategoryGrpcClient _categoryGrpcClient;
    private readonly IUserTodoViewPreferenceRepository _viewerPreferenceRepository;

    public GetTodoByIdQueryHandler(
        ITodoRepository repository,
        ICurrentUserContext currentUserContext,
        IMapper mapper,
        ILogger<GetTodoByIdQueryHandler> logger,
        IFriendshipService friendshipService,
        ICategoryGrpcClient categoryGrpcClient,
        IUserTodoViewPreferenceRepository viewerPreferenceRepository)
    {
        _repository = repository;
        _currentUserContext = currentUserContext;
        _mapper = mapper;
        _logger = logger;
        _friendshipService = friendshipService;
        _categoryGrpcClient = categoryGrpcClient;
        _viewerPreferenceRepository = viewerPreferenceRepository;
    }

    public async Task<Result<TodoItemDto>> Handle(GetTodoByIdQuery request, CancellationToken cancellationToken)
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

        // Check if user has access to this todo (owner or friend-visible)
        if (!isOwner && !hasFriendVisibleAccess)
        {
            throw new ForbiddenException("You do not have access to this todo item");
        }

        var viewerPreference = await _viewerPreferenceRepository.GetAsync(userId, todoItem.Id, cancellationToken);
        var effectiveHidden = TodoViewerStateResolver.GetEffectiveHidden(todoItem, userId, viewerPreference);
        var effectiveCategoryId = TodoViewerStateResolver.GetEffectiveCategoryId(todoItem, userId, viewerPreference);

        // Shared/public tasks use viewer-specific hidden state. Private owner tasks remain fully readable.
        if (HiddenTodoDtoFactory.ShouldMask(todoItem, userId, effectiveHidden))
        {
            CategoryInfo? categoryInfo = null;

            if (effectiveCategoryId.HasValue)
            {
                try
                {
                    categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                        effectiveCategoryId.Value,
                        userId,
                        cancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Could not enrich hidden todo {TodoId} with category data for {CategoryId}",
                        todoItem.Id, effectiveCategoryId.Value);
                }
            }

            return Result<TodoItemDto>.Success(
                HiddenTodoDtoFactory.CreateMasked(todoItem, userId, effectiveCategoryId, categoryInfo));
        }

        var dto = _mapper.Map<TodoItemDto>(todoItem) with
        {
            Hidden = effectiveHidden,
            CategoryId = effectiveCategoryId,
            CategoryName = null,
            CategoryColor = null,
            CategoryIcon = null,
            WorkerCount = todoItem.Workers.Count,
            WorkerUserIds = todoItem.Workers.Select(w => w.UserId).ToList(),
            RequiredWorkers = todoItem.RequiredWorkers,
            IsWorking = todoItem.UserId != userId && todoItem.Workers.Any(w => w.UserId == userId),
        };

        // Enrich with category data via gRPC so the full DTO always includes CategoryName/Color/Icon
        if (effectiveCategoryId.HasValue)
        {
            try
            {
                var categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                    effectiveCategoryId.Value,
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
                _logger.LogWarning(ex,
                    "Could not enrich todo {TodoId} with category data for {CategoryId}",
                    todoItem.Id, effectiveCategoryId.Value);
            }
        }

        return Result<TodoItemDto>.Success(dto);
    }
}

using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Queries.GetPublicTodos
{
    public sealed class GetPublicTodosQueryHandler : IRequestHandler<GetPublicTodosQuery, Result<PagedResult<TodoItemDto>>>
    {
        private readonly IRepository<TodoItem> _repository;
        private readonly IMapper _mapper;
        private readonly ILogger<GetPublicTodosQueryHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IFriendshipService _friendshipService;
        private readonly IUserTodoViewPreferenceRepository _viewerPreferenceRepository;

        public GetPublicTodosQueryHandler(
            IRepository<TodoItem> repository,
            IMapper mapper,
            ILogger<GetPublicTodosQueryHandler> logger,
            ICurrentUserContext currentUserContext,
            IFriendshipService friendshipService,
            IUserTodoViewPreferenceRepository viewerPreferenceRepository)
        {
            _repository = repository;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
            _friendshipService = friendshipService;
            _viewerPreferenceRepository = viewerPreferenceRepository;
        }

        public async Task<Result<PagedResult<TodoItemDto>>> Handle(
            GetPublicTodosQuery request,
            CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                return Result<PagedResult<TodoItemDto>>.Failure(new Error("AUTH_REQUIRED", "User context is not available"));

            try
            {
                _logger.LogInformation("🔍 GetPublicTodos called for userId {UserId}", userId);
                
                // Get friend IDs
                var friendIds = await _friendshipService.GetFriendIdsAsync(userId, cancellationToken);
                var friendIdsList = friendIds.ToList();
                
                _logger.LogInformation("📋 Retrieved {Count} friends for user {UserId}: {FriendIds}", 
                    friendIdsList.Count, userId, string.Join(", ", friendIdsList));

                // Load viewer's hidden-by-me preferences so they are excluded from all branches
                var hiddenTodoIds = await _viewerPreferenceRepository.GetHiddenTodoIdsAsync(userId, cancellationToken);

                // If FriendId is specified, verify friendship and get todos shared by that friend
                // Otherwise, get todos shared by all friends
                if (request.FriendId.HasValue)
                {
                    _logger.LogInformation("🎯 Filtering for specific friend {FriendId}", request.FriendId.Value);
                    
                    if (!friendIdsList.Contains(request.FriendId.Value))
                    {
                        _logger.LogWarning("⚠️ User {UserId} is not friends with {FriendId}", userId, request.FriendId.Value);
                        return Result<PagedResult<TodoItemDto>>.Failure(new Error("NOT_FRIENDS", "User is not a friend"));
                    }

                    var (friendItems, friendTotalCount) = await _repository.GetPagedAsync(
                        request.PageNumber,
                        request.PageSize,
                        t => t.UserId == request.FriendId &&
                             (t.IsPublic || t.SharedWith.Any(s => s.SharedWithUserId == userId)) &&
                             !t.IsDeleted &&
                             !hiddenTodoIds.Contains(t.Id),
                        t => t.CreatedAt,
                        false,
                        cancellationToken);

                    var friendDtos = friendItems.Select(item =>
                    {
                        var dto = _mapper.Map<TodoItemDto>(item);
                        return new TodoItemDto
                        {
                            Id = dto.Id,
                            Title = dto.Title,
                            Description = dto.Description,
                            Status = dto.Status,
                            IsCompleted = dto.IsCompleted,
                            IsPublic = dto.IsPublic,
                            Hidden = dto.Hidden,
                            Priority = dto.Priority,
                            DueDate = dto.DueDate,
                            ExpectedDate = dto.ExpectedDate,
                            ActualDate = dto.ActualDate,
                            CompletedAt = dto.CompletedAt,
                            IsOnTime = dto.IsOnTime,
                            Delay = dto.Delay,
                            UserId = dto.UserId,
                            CategoryId = null,
                            Tags = dto.Tags,
                            SharedWithUserIds = dto.SharedWithUserIds,
                            HasSharedAudience = dto.HasSharedAudience,
                            IsVisuallyUrgent = dto.IsVisuallyUrgent,
                            CreatedAt = dto.CreatedAt,
                            UpdatedAt = dto.UpdatedAt
                        };
                    }).ToList();

                    var friendPagedResult = new PagedResult<TodoItemDto>(friendDtos, request.PageNumber, request.PageSize, friendTotalCount);
                    return Result<PagedResult<TodoItemDto>>.Success(friendPagedResult);
                }

                // Get todos shared by all friends
                if (!friendIdsList.Any())
                {
                    return Result<PagedResult<TodoItemDto>>.Success(new PagedResult<TodoItemDto>(
                        new List<TodoItemDto>(),
                        request.PageNumber,
                        request.PageSize,
                        0));
                }

                var predicate = (System.Linq.Expressions.Expression<Func<TodoItem, bool>>)(t =>
                    friendIdsList.Contains(t.UserId) &&
                    (t.IsPublic || t.SharedWith.Any(s => s.SharedWithUserId == userId)) &&
                    !t.IsDeleted &&
                    !hiddenTodoIds.Contains(t.Id));

                var (items, totalCount) = await _repository.GetPagedAsync(
                    request.PageNumber,
                    request.PageSize,
                    predicate,
                    t => t.CreatedAt,
                    false,
                    cancellationToken);

                // Map to DTOs, excluding CategoryId for public todos (as per requirements)
                var dtos = items.Select(item =>
                {
                    var dto = _mapper.Map<TodoItemDto>(item);
                    // Create a new DTO without CategoryId for public todos
                    return new TodoItemDto
                    {
                        Id = dto.Id,
                        Title = dto.Title,
                        Description = dto.Description,
                        Status = dto.Status,
                        IsCompleted = dto.IsCompleted,
                        IsPublic = dto.IsPublic,
                        Hidden = dto.Hidden,
                        Priority = dto.Priority,
                        DueDate = dto.DueDate,
                        ExpectedDate = dto.ExpectedDate,
                        ActualDate = dto.ActualDate,
                        CompletedAt = dto.CompletedAt,
                        IsOnTime = dto.IsOnTime,
                        Delay = dto.Delay,
                        UserId = dto.UserId,
                        CategoryId = null,
                        Tags = dto.Tags,
                        SharedWithUserIds = dto.SharedWithUserIds,
                        HasSharedAudience = dto.HasSharedAudience,
                        IsVisuallyUrgent = dto.IsVisuallyUrgent,
                        CreatedAt = dto.CreatedAt,
                        UpdatedAt = dto.UpdatedAt
                    };
                }).ToList();

                var pagedResult = new PagedResult<TodoItemDto>(
                    dtos,
                    request.PageNumber,
                    request.PageSize,
                    totalCount);

                _logger.LogInformation(
                    "Retrieved {Count} shared todos for user {UserId}",
                    items.Count,
                    userId);

                return Result<PagedResult<TodoItemDto>>.Success(pagedResult);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to retrieve public todos for user {UserId}", userId);
                return Result<PagedResult<TodoItemDto>>.Failure(new Error("QUERY_FAILED", ex.Message));
            }
        }
    }
}


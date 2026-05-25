using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Queries.GetComments
{
    public sealed class GetCommentsQueryHandler
        : IQueryHandler<GetCommentsQuery, Result<PagedResult<TodoCommentDto>>>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly ITodoCommentRepository _commentRepository;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IFriendshipService _friendshipService;
        private readonly IUserService _userService;

        public GetCommentsQueryHandler(
            ITodoRepository todoRepository,
            ITodoCommentRepository commentRepository,
            ICurrentUserContext currentUserContext,
            IFriendshipService friendshipService,
            IUserService userService)
        {
            _todoRepository = todoRepository;
            _commentRepository = commentRepository;
            _currentUserContext = currentUserContext;
            _friendshipService = friendshipService;
            _userService = userService;
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
            var isSharedDirectly = todoItem.SharedWith.Any(s => s.SharedWithUserId == userId);
            var hasVisibility = todoItem.IsPublic || isSharedDirectly;
            var isFriend = hasVisibility && !isOwner
                ? await _friendshipService.AreFriendsAsync(userId, todoItem.UserId, cancellationToken)
                : false;
            var hasAccess = isOwner || isSharedDirectly && isFriend || todoItem.IsPublic && isFriend;

            if (!hasAccess)
                throw new ForbiddenException("You do not have access to this task");

            var (items, totalCount) = await _commentRepository.GetPagedByTodoIdAsync(
                request.TodoId, request.PageNumber, request.PageSize, cancellationToken);

            // Collect all user IDs whose stored avatar URL is missing or empty so we can
            // batch-fetch the current avatar from Auth as a live fallback.
            //
            // Regular comments: AuthorId is the actual commenter.
            // Genesis comment:  AuthorId = Guid.Empty by design (it's a system comment);
            //                   the real author is always the task owner (todoItem.UserId).
            var authorIdsNeedingAvatar = new HashSet<Guid>();

            foreach (var c in items)
            {
                if (!string.IsNullOrEmpty(c.AuthorAvatarUrl))
                    continue; // already stored — no lookup needed

                if (c.IsGenesisComment)
                {
                    // Genesis comment's real author is the task owner
                    authorIdsNeedingAvatar.Add(todoItem.UserId);
                }
                else if (!c.IsSystemComment && c.AuthorId != Guid.Empty)
                {
                    authorIdsNeedingAvatar.Add(c.AuthorId);
                }
            }

            IReadOnlyDictionary<Guid, string> liveAvatars = new Dictionary<Guid, string>();
            if (authorIdsNeedingAvatar.Count > 0)
            {
                liveAvatars = await _userService.GetUserAvatarsAsync(authorIdsNeedingAvatar, cancellationToken);
            }

            var dtos = items.Select(c =>
            {
                string? avatarUrl;
                if (!string.IsNullOrEmpty(c.AuthorAvatarUrl))
                {
                    // Stored value wins
                    avatarUrl = c.AuthorAvatarUrl;
                }
                else if (c.IsGenesisComment)
                {
                    // Live fallback keyed on the task owner
                    liveAvatars.TryGetValue(todoItem.UserId, out avatarUrl);
                }
                else
                {
                    // Live fallback keyed on the actual commenter
                    liveAvatars.TryGetValue(c.AuthorId, out avatarUrl);
                }

                return new TodoCommentDto(
                    c.Id,
                    c.TodoItemId,
                    c.AuthorId,
                    c.AuthorName,
                    avatarUrl,
                    c.Content,
                    c.CreatedAt,
                    c.UpdatedAt,
                    IsOwn: !c.IsSystemComment && c.AuthorId == userId,
                    IsEdited: c.IsEdited,
                    IsSystemComment: c.IsSystemComment,
                    IsGenesisComment: c.IsGenesisComment);
            }).ToList();

            return Result<PagedResult<TodoCommentDto>>.Success(
                new PagedResult<TodoCommentDto>(dtos, request.PageNumber, request.PageSize, totalCount));
        }
    }
}

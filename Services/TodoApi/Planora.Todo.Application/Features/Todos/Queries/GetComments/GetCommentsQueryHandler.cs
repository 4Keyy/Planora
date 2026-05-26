using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
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

            // Always batch-fetch avatars via Auth gRPC. The snapshot column was removed in
            // migration RemoveCommentAvatarSnapshot — single source of truth is the live
            // user profile, cached by CachingUserService (60 s TTL) so a paged read does
            // not multiply Auth load.
            //
            // Regular comments: AuthorId is the actual commenter.
            // Genesis comment:  AuthorId = Guid.Empty by design; the real author is the
            //                   task owner (todoItem.UserId).
            var authorIds = new HashSet<Guid>();
            foreach (var c in items)
            {
                if (c.IsGenesisComment)
                {
                    authorIds.Add(todoItem.UserId);
                }
                else if (!c.IsSystemComment && c.AuthorId != Guid.Empty)
                {
                    authorIds.Add(c.AuthorId);
                }
            }

            IReadOnlyDictionary<Guid, string> avatars = authorIds.Count > 0
                ? await _userService.GetUserAvatarsAsync(authorIds, cancellationToken)
                : new Dictionary<Guid, string>();

            var dtos = items.Select(c =>
            {
                string? avatarUrl;
                if (c.IsGenesisComment)
                {
                    avatars.TryGetValue(todoItem.UserId, out avatarUrl);
                }
                else
                {
                    avatars.TryGetValue(c.AuthorId, out avatarUrl);
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

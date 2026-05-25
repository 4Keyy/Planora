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

            // Collect author IDs whose stored avatar URL is missing — these are users who either
            // commented before the AuthorAvatarUrl column was added, or before uploading their avatar.
            // We batch-fetch the current avatar from Auth API and use it as a live fallback.
            var authorIdsNeedingAvatar = items
                .Where(c => !c.IsSystemComment && c.AuthorId != Guid.Empty && string.IsNullOrEmpty(c.AuthorAvatarUrl))
                .Select(c => c.AuthorId)
                .Distinct()
                .ToList();

            IReadOnlyDictionary<Guid, string> liveAvatars = new Dictionary<Guid, string>();
            if (authorIdsNeedingAvatar.Count > 0)
            {
                liveAvatars = await _userService.GetUserAvatarsAsync(authorIdsNeedingAvatar, cancellationToken);
            }

            var dtos = items.Select(c =>
            {
                // Prefer the stored URL; fall back to the live avatar fetched from Auth.
                var avatarUrl = !string.IsNullOrEmpty(c.AuthorAvatarUrl)
                    ? c.AuthorAvatarUrl
                    : (liveAvatars.TryGetValue(c.AuthorId, out var live) ? live : null);

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

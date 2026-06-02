using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.Comments.Queries.GetComments
{
    public sealed class GetCommentsQueryHandler
        : IQueryHandler<GetCommentsQuery, Result<PagedResult<CommentDto>>>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ITaskAccessService _taskAccessService;
        private readonly IUserService _userService;

        public GetCommentsQueryHandler(
            ICommentRepository commentRepository,
            ICurrentUserContext currentUserContext,
            ITaskAccessService taskAccessService,
            IUserService userService)
        {
            _commentRepository = commentRepository;
            _currentUserContext = currentUserContext;
            _taskAccessService = taskAccessService;
            _userService = userService;
        }

        public async Task<Result<PagedResult<CommentDto>>> Handle(
            GetCommentsQuery request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                return Result<PagedResult<CommentDto>>.Failure(
                    new Error("AUTH_REQUIRED", "User context is not available"));

            var access = await _taskAccessService.CheckCommentAccessAsync(request.TaskId, userId, cancellationToken);
            if (!access.Exists)
                throw new EntityNotFoundException("Task", request.TaskId);
            if (!access.HasAccess)
                throw new ForbiddenException("You do not have access to this task");

            var (items, totalCount) = await _commentRepository.GetPagedByTaskIdAsync(
                request.TaskId, request.PageNumber, request.PageSize, cancellationToken);

            // The genesis (the task description) is synthesised on the FIRST page only, from the
            // live task description returned by the Todo access check — Collaboration stores no
            // copy of it (single source of truth in Todo). This makes the description appear
            // instantly, always match the task card, and work for tasks created before this service.
            var hasGenesis = request.PageNumber <= 1 && !string.IsNullOrWhiteSpace(access.Description);

            // Resolve author identity LIVE (display name + avatar) so a profile rename is reflected
            // everywhere and the name is never a stored copy. Author ids: real comment authors plus
            // the task owner (the synthesised genesis author).
            var authorIds = new HashSet<Guid>();
            foreach (var c in items)
                if (!c.IsSystemComment && c.AuthorId != Guid.Empty)
                    authorIds.Add(c.AuthorId);
            if (hasGenesis && access.OwnerId != Guid.Empty)
                authorIds.Add(access.OwnerId);

            IReadOnlyDictionary<Guid, UserProfile> profiles = authorIds.Count > 0
                ? await _userService.GetUserProfilesAsync(authorIds, cancellationToken)
                : new Dictionary<Guid, UserProfile>();

            var dtos = new List<CommentDto>(items.Count + (hasGenesis ? 1 : 0));

            if (hasGenesis)
            {
                profiles.TryGetValue(access.OwnerId, out var ownerProfile);
                // Stable, deterministic id (the task id) so the pinned note keeps a constant React
                // key across reloads/pages. Editing it routes to the task, not to a comment id.
                dtos.Add(new CommentDto(
                    request.TaskId,
                    request.TaskId,
                    access.OwnerId,
                    ownerProfile?.DisplayName ?? string.Empty,
                    ownerProfile?.AvatarUrl,
                    access.Description,
                    access.TaskCreatedAt ?? DateTime.UtcNow,
                    UpdatedAt: null,
                    IsOwn: access.OwnerId == userId,
                    IsEdited: false,
                    IsSystemComment: true,
                    IsGenesisComment: true));
            }

            foreach (var c in items)
            {
                string authorName = c.AuthorName;
                string? avatarUrl = null;
                if (!c.IsSystemComment && profiles.TryGetValue(c.AuthorId, out var p))
                {
                    if (!string.IsNullOrWhiteSpace(p.DisplayName)) authorName = p.DisplayName;
                    avatarUrl = p.AvatarUrl;
                }

                dtos.Add(new CommentDto(
                    c.Id,
                    c.TaskId,
                    c.AuthorId,
                    authorName,
                    avatarUrl,
                    c.Content,
                    c.CreatedAt,
                    c.UpdatedAt,
                    IsOwn: !c.IsSystemComment && c.AuthorId == userId,
                    IsEdited: c.IsEdited,
                    IsSystemComment: c.IsSystemComment,
                    IsGenesisComment: false));
            }

            return Result<PagedResult<CommentDto>>.Success(
                new PagedResult<CommentDto>(
                    dtos, request.PageNumber, request.PageSize, totalCount + (hasGenesis ? 1 : 0)));
        }
    }
}

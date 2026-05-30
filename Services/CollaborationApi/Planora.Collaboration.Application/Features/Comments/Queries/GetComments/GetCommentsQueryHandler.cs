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

            // Always batch-fetch avatars via Auth gRPC (single source of truth is the live
            // user profile), cached by CachingUserService (60 s TTL) so a paged read does not
            // multiply Auth load.
            //
            // Regular comments: AuthorId is the actual commenter.
            // Genesis comment:  AuthorId = Guid.Empty by design; the real author is the
            //                   task owner (access.OwnerId).
            var authorIds = new HashSet<Guid>();
            foreach (var c in items)
            {
                if (c.IsGenesisComment)
                {
                    if (access.OwnerId != Guid.Empty)
                        authorIds.Add(access.OwnerId);
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
                    avatars.TryGetValue(access.OwnerId, out avatarUrl);
                }
                else
                {
                    avatars.TryGetValue(c.AuthorId, out avatarUrl);
                }

                return new CommentDto(
                    c.Id,
                    c.TaskId,
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

            return Result<PagedResult<CommentDto>>.Success(
                new PagedResult<CommentDto>(dtos, request.PageNumber, request.PageSize, totalCount));
        }
    }
}

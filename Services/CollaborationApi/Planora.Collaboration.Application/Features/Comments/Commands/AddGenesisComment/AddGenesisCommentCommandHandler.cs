using MediatR;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.Collaboration.Application.Features.Comments.Commands.AddGenesisComment
{
    public sealed class AddGenesisCommentCommandHandler : IRequestHandler<AddGenesisCommentCommand, Result<CommentDto>>
    {
        private readonly ICommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ITaskAccessService _taskAccessService;

        public AddGenesisCommentCommandHandler(
            ICommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            ITaskAccessService taskAccessService)
        {
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _taskAccessService = taskAccessService;
        }

        public async Task<Result<CommentDto>> Handle(AddGenesisCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var access = await _taskAccessService.CheckCommentAccessAsync(request.TaskId, userId, cancellationToken);
            if (!access.Exists)
                throw new EntityNotFoundException("Task", request.TaskId);

            if (access.OwnerId != userId)
                throw new ForbiddenException("Only the task owner can add a description");

            var existing = await _commentRepository.GetGenesisCommentAsync(request.TaskId, cancellationToken);
            if (existing is not null)
                return Result<CommentDto>.Failure(new Error("GENESIS_ALREADY_EXISTS", "A description already exists for this task"));

            var authorName = _currentUserContext.Name
                ?? _currentUserContext.Email
                ?? userId.ToString();

            var comment = Comment.CreateGenesis(request.TaskId, request.Content, authorName);
            await _commentRepository.AddAsync(comment, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            var authorAvatarUrl = string.IsNullOrEmpty(_currentUserContext.ProfilePictureUrl)
                ? null
                : _currentUserContext.ProfilePictureUrl;

            return Result<CommentDto>.Success(new CommentDto(
                comment.Id,
                comment.TaskId,
                comment.AuthorId,
                comment.AuthorName,
                authorAvatarUrl,
                comment.Content,
                comment.CreatedAt,
                comment.UpdatedAt,
                IsOwn: true,
                IsEdited: false,
                IsSystemComment: true,
                IsGenesisComment: true));
        }
    }
}

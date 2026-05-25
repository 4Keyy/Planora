using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Commands.AddGenesisComment
{
    public sealed class AddGenesisCommentCommandHandler : IRequestHandler<AddGenesisCommentCommand, Result<TodoCommentDto>>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly ITodoCommentRepository _commentRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;

        public AddGenesisCommentCommandHandler(
            ITodoRepository todoRepository,
            ITodoCommentRepository commentRepository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext)
        {
            _todoRepository = todoRepository;
            _commentRepository = commentRepository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result<TodoCommentDto>> Handle(AddGenesisCommentCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var todoItem = await _todoRepository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            if (todoItem.UserId != userId)
                throw new ForbiddenException("Only the task owner can add a description");

            var existing = await _commentRepository.GetGenesisCommentAsync(request.TodoId, cancellationToken);
            if (existing is not null)
                return Result<TodoCommentDto>.Failure(new Error("GENESIS_ALREADY_EXISTS", "A description already exists for this task"));

            var authorName = _currentUserContext.Name
                ?? _currentUserContext.Email
                ?? userId.ToString();

            var authorAvatarUrl = string.IsNullOrEmpty(_currentUserContext.ProfilePictureUrl)
                ? null
                : _currentUserContext.ProfilePictureUrl;

            var comment = TodoItemComment.CreateGenesis(todoItem.Id, request.Content, authorName, authorAvatarUrl);
            await _commentRepository.AddAsync(comment, cancellationToken);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            return Result<TodoCommentDto>.Success(new TodoCommentDto(
                comment.Id,
                comment.TodoItemId,
                comment.AuthorId,
                comment.AuthorName,
                comment.AuthorAvatarUrl,
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

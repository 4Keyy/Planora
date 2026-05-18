using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Microsoft.Extensions.Logging;

namespace Planora.Todo.Application.Features.Todos.Commands.JoinTodo
{
    public sealed class JoinTodoCommandHandler : IRequestHandler<JoinTodoCommand, Result<TodoItemDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IMapper _mapper;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IFriendshipService _friendshipService;
        private readonly ITodoCommentRepository _commentRepository;
        private readonly ILogger<JoinTodoCommandHandler> _logger;

        public JoinTodoCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ICurrentUserContext currentUserContext,
            IFriendshipService friendshipService,
            ITodoCommentRepository commentRepository,
            ILogger<JoinTodoCommandHandler> logger)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _currentUserContext = currentUserContext;
            _friendshipService = friendshipService;
            _commentRepository = commentRepository;
            _logger = logger;
        }

        public async Task<Result<TodoItemDto>> Handle(JoinTodoCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var todoItem = await _repository.GetByIdWithIncludesTrackedAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            if (todoItem.UserId == userId)
            {
                var ownerDto = _mapper.Map<TodoItemDto>(todoItem) with
                {
                    WorkerCount = todoItem.Workers.Count,
                    WorkerUserIds = todoItem.Workers.Select(w => w.UserId).ToList(),
                    RequiredWorkers = todoItem.RequiredWorkers,
                    IsWorking = true,
                };
                return Result<TodoItemDto>.Success(ownerDto);
            }

            var canAccess = todoItem.IsPublic || todoItem.SharedWith.Any(s => s.SharedWithUserId == userId);
            if (!canAccess)
                throw new ForbiddenException("You do not have access to this task");

            // For shared (non-public) tasks, require friendship; public tasks are open to anyone
            if (!todoItem.IsPublic)
            {
                var areFriends = await _friendshipService.AreFriendsAsync(userId, todoItem.UserId, cancellationToken);
                if (!areFriends)
                    throw new ForbiddenException("You must be friends with the task owner to join");
            }

            // Idempotent: already a worker → return current state as success
            if (todoItem.Workers.Any(w => w.UserId == userId))
            {
                var existing = _mapper.Map<TodoItemDto>(todoItem) with
                {
                    WorkerCount = todoItem.Workers.Count,
                    WorkerUserIds = todoItem.Workers.Select(w => w.UserId).ToList(),
                    RequiredWorkers = todoItem.RequiredWorkers,
                    IsWorking = true,
                };
                return Result<TodoItemDto>.Success(existing);
            }

            todoItem.AddWorker(userId);

            var userName = _currentUserContext.Name ?? _currentUserContext.Email ?? userId.ToString();
            var systemComment = TodoItemComment.CreateSystem(todoItem.Id, $"{userName} started working on the task");
            await _commentRepository.AddAsync(systemComment, cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            var activeWorkerTaskCount = await _repository.GetActiveWorkerTaskCountAsync(userId, cancellationToken);
            _logger.LogInformation(
                "User {UserId} joined task {TodoId}. Active worker task count: {Count}",
                userId, todoItem.Id, activeWorkerTaskCount);

            var dto = _mapper.Map<TodoItemDto>(todoItem) with
            {
                WorkerCount = todoItem.Workers.Count,
                WorkerUserIds = todoItem.Workers.Select(w => w.UserId).ToList(),
                RequiredWorkers = todoItem.RequiredWorkers,
                IsWorking = true,
            };

            return Result<TodoItemDto>.Success(dto);
        }
    }
}

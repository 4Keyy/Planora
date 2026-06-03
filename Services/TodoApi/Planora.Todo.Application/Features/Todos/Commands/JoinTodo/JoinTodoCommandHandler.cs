using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Context;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Application.Common;
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
        private readonly IOutboxRepository _outboxRepository;
        private readonly ILogger<JoinTodoCommandHandler> _logger;

        public JoinTodoCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ICurrentUserContext currentUserContext,
            IFriendshipService friendshipService,
            IOutboxRepository outboxRepository,
            ILogger<JoinTodoCommandHandler> logger)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _currentUserContext = currentUserContext;
            _friendshipService = friendshipService;
            _outboxRepository = outboxRepository;
            _logger = logger;
        }

        public async Task<Result<TodoItemDto>> Handle(JoinTodoCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;
            if (userId == Guid.Empty)
                throw new UnauthorizedAccessException("User context is not available");

            var todoItem = await _repository.GetByIdWithIncludesTrackedAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            // Subtask "in work" is per-user: anyone with access (the owner included) opts in as a
            // worker and is counted, with NO branch notification. A normal task keeps the classic
            // model (the owner is implicitly working; only collaborators hold worker rows).
            var isSubtask = todoItem.IsSubtask;

            if (todoItem.UserId == userId && !isSubtask)
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

            // The owner always has access to their own subtask; everyone else needs share/public + friendship.
            if (todoItem.UserId != userId)
            {
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

            // Subtasks have no branch of their own and never post a "started working" notification —
            // their in-work state is shown only as an anonymous worker count. Normal tasks announce it.
            if (!isSubtask)
            {
                var userName = _currentUserContext.Name ?? _currentUserContext.Email ?? userId.ToString();
                await _outboxRepository.EnqueueIntegrationEventAsync(
                    new TaskActivityIntegrationEvent(todoItem.Id, userId, userName, TaskActivityType.StartedWorking),
                    cancellationToken);
            }

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

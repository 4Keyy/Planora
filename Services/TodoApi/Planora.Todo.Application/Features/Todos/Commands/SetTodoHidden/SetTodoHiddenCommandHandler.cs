using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using MediatR;
using Microsoft.Extensions.Logging;

namespace Planora.Todo.Application.Features.Todos.Commands.SetTodoHidden
{
    public sealed class SetTodoHiddenCommandHandler : IRequestHandler<SetTodoHiddenCommand, Result<TodoHiddenResponseDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly ILogger<SetTodoHiddenCommandHandler> _logger;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IUserTodoViewPreferenceRepository _viewerPreferenceRepository;

        public SetTodoHiddenCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            ILogger<SetTodoHiddenCommandHandler> logger,
            ICategoryGrpcClient categoryGrpcClient,
            IUserTodoViewPreferenceRepository viewerPreferenceRepository)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _logger = logger;
            _categoryGrpcClient = categoryGrpcClient;
            _viewerPreferenceRepository = viewerPreferenceRepository;
        }

        public async Task<Result<TodoHiddenResponseDto>> Handle(
            SetTodoHiddenCommand request,
            CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            var todoItem = await _repository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            if (todoItem.UserId != userId)
                throw new ForbiddenException("You can only hide your own tasks");

            var isSharedTask = todoItem.IsPublic || todoItem.SharedWith.Any();
            if (isSharedTask)
            {
                var preference = await _viewerPreferenceRepository.GetAsync(userId, request.TodoId, cancellationToken)
                    ?? new UserTodoViewPreference
                    {
                        ViewerId = userId,
                        TodoItemId = request.TodoId
                    };

                preference.HiddenByViewer = request.Hidden;
                await _viewerPreferenceRepository.UpsertAsync(preference, cancellationToken);

                // Legacy shared tasks may have used the global Hidden flag.
                // Clear it here so it no longer leaks to other viewers.
                if (todoItem.Hidden)
                {
                    todoItem.SetHidden(false, userId);
                    _repository.Update(todoItem);
                }
            }
            else
            {
                todoItem.SetHidden(request.Hidden, userId);
                _repository.Update(todoItem);
            }

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Todo {TodoId} hidden state set to {Hidden} by user {UserId}",
                request.TodoId, request.Hidden, userId);

            // Fetch category info via gRPC so the response always carries CategoryName
            string? categoryName = null;
            if (todoItem.CategoryId.HasValue)
            {
                try
                {
                    var categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                        todoItem.CategoryId.Value,
                        userId,
                        cancellationToken);
                    categoryName = categoryInfo?.Name;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "Could not fetch category name for todo {TodoId}, category {CategoryId}",
                        todoItem.Id, todoItem.CategoryId.Value);
                }
            }

            return Result<TodoHiddenResponseDto>.Success(new TodoHiddenResponseDto
            {
                Id = todoItem.Id,
                Hidden = request.Hidden,
                CategoryName = categoryName,
                CategoryId = todoItem.CategoryId
            });
        }
    }
}

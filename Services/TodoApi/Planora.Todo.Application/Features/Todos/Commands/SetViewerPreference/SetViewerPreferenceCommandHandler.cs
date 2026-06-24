using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Application.Context;
using Planora.Todo.Application.DTOs;
using Planora.Todo.Application.Interfaces;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using MediatR;
using Microsoft.Extensions.Logging;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Todo.Application.Features.Todos.Commands.SetViewerPreference
{
    public sealed class SetViewerPreferenceCommandHandler : IRequestHandler<SetViewerPreferenceCommand, Result<ViewerPreferenceResponseDto>>
    {
        private readonly ITodoRepository _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IUserTodoViewPreferenceRepository _viewerPreferenceRepository;
        private readonly IFriendshipService _friendshipService;
        private readonly ICategoryGrpcClient _categoryGrpcClient;
        private readonly IBusinessEventLogger? _businessLogger;
        private readonly ILogger<SetViewerPreferenceCommandHandler> _logger;

        public SetViewerPreferenceCommandHandler(
            ITodoRepository repository,
            IUnitOfWork unitOfWork,
            ICurrentUserContext currentUserContext,
            IUserTodoViewPreferenceRepository viewerPreferenceRepository,
            IFriendshipService friendshipService,
            ICategoryGrpcClient categoryGrpcClient,
            ILogger<SetViewerPreferenceCommandHandler> logger,
            IBusinessEventLogger? businessLogger = null)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _currentUserContext = currentUserContext;
            _viewerPreferenceRepository = viewerPreferenceRepository;
            _friendshipService = friendshipService;
            _categoryGrpcClient = categoryGrpcClient;
            _logger = logger;
            _businessLogger = businessLogger;
        }

        public async Task<Result<ViewerPreferenceResponseDto>> Handle(
            SetViewerPreferenceCommand request,
            CancellationToken cancellationToken)
        {
            var viewerId = _currentUserContext.UserId;

            var todoItem = await _repository.GetByIdWithIncludesAsync(request.TodoId, cancellationToken)
                ?? throw new EntityNotFoundException("TodoItem", request.TodoId);

            if (todoItem.UserId == viewerId)
                return Result<ViewerPreferenceResponseDto>.Failure(new Error(
                    "OWNER_MUST_USE_HIDDEN_ENDPOINT",
                    "Task owners should use the /hidden endpoint"));

            var isFriendVisible = todoItem.IsPublic || todoItem.SharedWith.Any(s => s.SharedWithUserId == viewerId);
            if (!isFriendVisible || !await _friendshipService.AreFriendsAsync(viewerId, todoItem.UserId, cancellationToken))
            {
                throw new ForbiddenException("You can only set preferences for public or shared tasks from friends");
            }

            if (!request.HiddenByViewer.HasValue && !request.UpdateViewerCategory && !request.CompletedByViewer.HasValue)
            {
                return Result<ViewerPreferenceResponseDto>.Failure(new Error(
                    "INVALID_VIEWER_PREFERENCE_REQUEST",
                    "At least one viewer preference must be provided"));
            }

            var preference = await _viewerPreferenceRepository.GetAsync(viewerId, request.TodoId, cancellationToken)
                ?? new UserTodoViewPreference
                {
                    ViewerId = viewerId,
                    TodoItemId = request.TodoId
                };
            var wasHiddenByViewer = preference.HiddenByViewer;

            if (request.HiddenByViewer.HasValue)
            {
                preference.HiddenByViewer = request.HiddenByViewer.Value;
            }

            if (request.UpdateViewerCategory)
            {
                var viewerCategoryId = request.ViewerCategoryId == Guid.Empty
                    ? null
                    : request.ViewerCategoryId;

                if (viewerCategoryId.HasValue)
                {
                    var categoryInfo = await _categoryGrpcClient.GetCategoryInfoAsync(
                        viewerCategoryId.Value,
                        viewerId,
                        cancellationToken);

                    if (categoryInfo is null)
                        throw new ForbiddenException("Viewer category does not belong to the current user");
                }

                preference.ViewerCategoryId = viewerCategoryId;
            }

            if (request.CompletedByViewer.HasValue)
            {
                // A viewer may freely return THEIR OWN completion to active — UNLESS the author has
                // marked the whole task done globally (Status == Done). Once the author closes it, the
                // task is finished for everyone and a viewer must duplicate it to work on their own copy.
                // (Owners never reach this handler — they are rejected above with
                // OWNER_MUST_USE_HIDDEN_ENDPOINT.) This is the server-side guard behind the proactive UI.
                if (!request.CompletedByViewer.Value && preference.CompletedByViewer && todoItem.IsCompleted)
                    return Result<ViewerPreferenceResponseDto>.Failure(new Error(
                        "AUTHOR_ALREADY_COMPLETED",
                        "Автор уже отметил задачу выполненной — вернуть её в работу нельзя. Сделайте копию."));

                preference.CompletedByViewer = request.CompletedByViewer.Value;
                preference.CompletedByViewerAt = request.CompletedByViewer.Value ? DateTime.UtcNow : (DateTime?)null;
            }

            await _viewerPreferenceRepository.UpsertAsync(preference, cancellationToken);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            if (_businessLogger is not null && wasHiddenByViewer && request.HiddenByViewer == false)
            {
                _businessLogger.LogBusinessEvent(
                    HiddenTodoRevealed,
                    $"Viewer {viewerId} revealed hidden todo {request.TodoId}",
                    new { TodoId = request.TodoId, OwnerId = todoItem.UserId },
                    viewerId.ToString());
            }

            _logger.LogInformation(
                "Viewer {ViewerId} updated preferences for todo {TodoId}: HiddenByViewer={Hidden}, ViewerCategoryId={ViewerCategoryId}, CompletedByViewer={CompletedByViewer}",
                viewerId, request.TodoId, preference.HiddenByViewer, preference.ViewerCategoryId, preference.CompletedByViewer);

            return Result<ViewerPreferenceResponseDto>.Success(new ViewerPreferenceResponseDto
            {
                TodoId = request.TodoId,
                HiddenByViewer = preference.HiddenByViewer,
                ViewerCategoryId = preference.ViewerCategoryId,
                CompletedByViewer = preference.CompletedByViewer,
                OwnerCompleted = todoItem.IsCompleted
            });
        }
    }
}

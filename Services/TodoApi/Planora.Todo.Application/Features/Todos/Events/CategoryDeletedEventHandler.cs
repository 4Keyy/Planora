using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using Planora.Todo.Domain.Repositories;

namespace Planora.Todo.Application.Features.Todos.Events
{
    public sealed class CategoryDeletedEventHandler : IIntegrationEventHandler<CategoryDeletedIntegrationEvent>
    {
        private readonly ITodoRepository _todoRepository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<CategoryDeletedEventHandler> _logger;

        public CategoryDeletedEventHandler(
            ITodoRepository todoRepository,
            IUnitOfWork unitOfWork,
            ILogger<CategoryDeletedEventHandler> logger)
        {
            _todoRepository = todoRepository;
            _unitOfWork = unitOfWork;
            _logger = logger;
        }

        public async Task HandleAsync(CategoryDeletedIntegrationEvent @event, CancellationToken cancellationToken)
        {
            try
            {
                // Get all todos with this category
                var todos = await _todoRepository.GetByCategoryIdAsync(@event.CategoryId, cancellationToken);

                // Set CategoryId to null for all related todos
                if (todos.Any())
                {
                    foreach (var todo in todos)
                    {
                        todo.UpdateCategory(null, @event.UserId);
                        _todoRepository.Update(todo);
                    }

                    await _unitOfWork.SaveChangesAsync(cancellationToken);
                    
                    _logger.LogInformation(
                        "Successfully nullified CategoryId for {Count} todos after category {CategoryId} deletion",
                        todos.Count,
                        @event.CategoryId);
                }
                else
                {
                    _logger.LogInformation(
                        "No todos found for category {CategoryId} to update",
                        @event.CategoryId);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Failed to update todos after category {CategoryId} deletion",
                    @event.CategoryId);
                throw;
            }
        }
    }
}


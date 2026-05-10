using Planora.BuildingBlocks.Infrastructure.Context;

namespace Planora.Category.Application.Features.Categories.Commands.DeleteCategory
{
    public sealed class DeleteCategoryCommandHandler : IRequestHandler<DeleteCategoryCommand, Result>
    {
        private readonly IRepository<Domain.Entities.Category> _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly ILogger<DeleteCategoryCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;

        public DeleteCategoryCommandHandler(
            IRepository<Domain.Entities.Category> repository,
            IUnitOfWork unitOfWork,
            ILogger<DeleteCategoryCommandHandler> logger,
            ICurrentUserContext currentUserContext)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _logger = logger;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result> Handle(DeleteCategoryCommand request, CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            try
            {
                var category = await _repository.GetByIdAsync(request.CategoryId, cancellationToken);
                if (category == null)
                    return Result.Failure("CATEGORY_NOT_FOUND", "Category not found");

                if (category.UserId != userId)
                    return Result.Failure("FORBIDDEN", "Access denied");

                category.Delete(userId);
                _repository.Update(category);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation("Category deleted: {CategoryId} by user {UserId}", request.CategoryId, userId);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to delete category {CategoryId}", request.CategoryId);
                return Result.Failure("DELETE_FAILED", ex.Message);
            }
        }
    }
}

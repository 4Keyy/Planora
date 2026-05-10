using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Category.Application.DTOs;

namespace Planora.Category.Application.Features.Categories.Commands.UpdateCategory
{
    public sealed class UpdateCategoryCommandHandler : IRequestHandler<UpdateCategoryCommand, Result<CategoryDto>>
    {
        private readonly IRepository<Domain.Entities.Category> _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IMapper _mapper;
        private readonly ILogger<UpdateCategoryCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;

        public UpdateCategoryCommandHandler(
            IRepository<Domain.Entities.Category> repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ILogger<UpdateCategoryCommandHandler> logger,
            ICurrentUserContext currentUserContext)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result<CategoryDto>> Handle(
            UpdateCategoryCommand request,
            CancellationToken cancellationToken)
        {
            var userId = _currentUserContext.UserId;

            try
            {
                var category = await _repository.GetByIdAsync(request.CategoryId, cancellationToken);
                if (category == null)
                    return Result.Failure<CategoryDto>("CATEGORY_NOT_FOUND", "Category not found");

                if (category.UserId != userId)
                    return Result.Failure<CategoryDto>("FORBIDDEN", "Access denied");

                if (!string.IsNullOrEmpty(request.Name))
                    category.UpdateName(request.Name);

                if (request.Description != null)
                    category.UpdateDescription(request.Description);

                if (!string.IsNullOrEmpty(request.Color))
                {
                    category.UpdateAppearance(request.Color, request.Icon);
                }
                else if (!string.IsNullOrEmpty(request.Icon))
                {
                    category.UpdateAppearance(category.Color, request.Icon);
                }

                if (request.DisplayOrder.HasValue)
                    category.SetDisplayOrder(request.DisplayOrder.Value);

                _repository.Update(category);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation("Category updated: {CategoryId} by user {UserId}", request.CategoryId, userId);

                var dto = _mapper.Map<CategoryDto>(category);
                return Result.Success(dto);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to update category {CategoryId}", request.CategoryId);
                return Result.Failure<CategoryDto>("UPDATE_FAILED", ex.Message);
            }
        }
    }
}

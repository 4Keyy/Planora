using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.BuildingBlocks.Application.Services;
using Planora.Category.Application.DTOs;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Category.Application.Features.Categories.Commands.CreateCategory
{
    public sealed class CreateCategoryCommandHandler : IRequestHandler<CreateCategoryCommand, Result<CategoryDto>>
    {
        private readonly IRepository<Domain.Entities.Category> _repository;
        private readonly IUnitOfWork _unitOfWork;
        private readonly IMapper _mapper;
        private readonly ILogger<CreateCategoryCommandHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;
        private readonly IBusinessEventLogger? _businessLogger;

        public CreateCategoryCommandHandler(
            IRepository<Domain.Entities.Category> repository,
            IUnitOfWork unitOfWork,
            IMapper mapper,
            ILogger<CreateCategoryCommandHandler> logger,
            ICurrentUserContext currentUserContext,
            IBusinessEventLogger? businessLogger = null)
        {
            _repository = repository;
            _unitOfWork = unitOfWork;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
            _businessLogger = businessLogger;
        }

        public async Task<Result<CategoryDto>> Handle(CreateCategoryCommand request, CancellationToken cancellationToken)
        {
            try
            {
                var userId = _currentUserContext.UserId;
                var category = Domain.Entities.Category.Create(
                    userId,
                    request.Name,
                    request.Description,
                    request.Color ?? "#000000",
                    request.Icon,
                    request.DisplayOrder);

                await _repository.AddAsync(category, cancellationToken);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                var dto = _mapper.Map<CategoryDto>(category);
                if (_businessLogger is not null)
                {
                    var existingCategoryCount = await TryCountUserCategoriesAsync(userId, cancellationToken);
                    if (existingCategoryCount <= 1)
                    {
                        _businessLogger.LogBusinessEvent(
                            FirstCategoryCreated,
                            $"User {userId} created their first category",
                            new { CategoryId = category.Id, category.Name },
                            userId.ToString());
                    }
                }

                _logger.LogInformation("Category created: {CategoryId}", category.Id);
                return Result.Success(dto);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to create category");
                return Result.Failure<CategoryDto>("CREATE_FAILED", ex.Message);
            }
        }

        private async Task<int> TryCountUserCategoriesAsync(Guid userId, CancellationToken cancellationToken)
        {
            try
            {
                return await _repository.CountAsync(
                    category => category.UserId == userId && !category.IsDeleted,
                    cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Could not count categories for first-category analytics event");
                return int.MaxValue;
            }
        }
    }
}

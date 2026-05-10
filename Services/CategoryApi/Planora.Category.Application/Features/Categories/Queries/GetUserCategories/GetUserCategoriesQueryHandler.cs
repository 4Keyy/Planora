using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Category.Application.DTOs;

namespace Planora.Category.Application.Features.Categories.Queries.GetUserCategories
{
    public sealed class GetUserCategoriesQueryHandler : IRequestHandler<GetUserCategoriesQuery, Result<IReadOnlyList<CategoryDto>>>
    {
        private readonly IRepository<Domain.Entities.Category> _repository;
        private readonly IMapper _mapper;
        private readonly ILogger<GetUserCategoriesQueryHandler> _logger;
        private readonly ICurrentUserContext _currentUserContext;

        public GetUserCategoriesQueryHandler(
            IRepository<Domain.Entities.Category> repository,
            IMapper mapper,
            ILogger<GetUserCategoriesQueryHandler> logger,
            ICurrentUserContext currentUserContext)
        {
            _repository = repository;
            _mapper = mapper;
            _logger = logger;
            _currentUserContext = currentUserContext;
        }

        public async Task<Result<IReadOnlyList<CategoryDto>>> Handle(GetUserCategoriesQuery request, CancellationToken cancellationToken)
        {
            var userId = request.UserId ?? _currentUserContext.UserId;
            if (userId == Guid.Empty)
                return Result.Failure<IReadOnlyList<CategoryDto>>("AUTH_REQUIRED", "User context is not available");

            try
            {
                var categories = await _repository.FindAsync(
                    c => c.UserId == userId && !c.IsDeleted,
                    cancellationToken);

                var dtos = categories
                    .OrderBy(c => c.Order)
                    .Select(c => _mapper.Map<CategoryDto>(c))
                    .ToList();

                return Result.Success<IReadOnlyList<CategoryDto>>(dtos);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to get user categories");
                return Result.Failure<IReadOnlyList<CategoryDto>>("QUERY_FAILED", ex.Message);
            }
        }
    }
}

using AutoMapper;
using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Domain;
using Planora.BuildingBlocks.Infrastructure.Context;
using Planora.Category.Application.DTOs;
using Planora.Category.Domain.Repositories;
using DomainError = Planora.BuildingBlocks.Domain.Error;

namespace Planora.Category.Application.Features.Categories.Queries.GetCategoryById;

public sealed class GetCategoryByIdQueryHandler : IQueryHandler<GetCategoryByIdQuery, Planora.BuildingBlocks.Domain.Result<CategoryDto>>
{
    private readonly ICategoryRepository _repository;
    private readonly IMapper _mapper;
    private readonly ICurrentUserContext _currentUserContext;

    public GetCategoryByIdQueryHandler(
        ICategoryRepository repository,
        IMapper mapper,
        ICurrentUserContext currentUserContext)
    {
        _repository = repository;
        _mapper = mapper;
        _currentUserContext = currentUserContext;
    }

    public async Task<Planora.BuildingBlocks.Domain.Result<CategoryDto>> Handle(GetCategoryByIdQuery request, CancellationToken cancellationToken)
    {
        var userId = request.UserId ?? _currentUserContext.UserId;
        if (userId == Guid.Empty)
        {
            return Planora.BuildingBlocks.Domain.Result<CategoryDto>.Failure(
                DomainError.Unauthorized("AUTH_REQUIRED", "User context is not available"));
        }

        var category = await _repository.GetByIdAndUserIdAsync(request.CategoryId, userId, cancellationToken);

        if (category == null)
        {
            return Planora.BuildingBlocks.Domain.Result<CategoryDto>.Failure(
                DomainError.NotFound("CATEGORY_NOT_FOUND", $"Category with ID {request.CategoryId} not found"));
        }

        var dto = _mapper.Map<CategoryDto>(category);
        return Planora.BuildingBlocks.Domain.Result<CategoryDto>.Success(dto);
    }
}

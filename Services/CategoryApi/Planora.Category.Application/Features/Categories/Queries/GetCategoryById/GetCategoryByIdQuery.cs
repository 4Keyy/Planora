using Planora.BuildingBlocks.Application.CQRS;
using Planora.Category.Application.DTOs;

namespace Planora.Category.Application.Features.Categories.Queries.GetCategoryById;

public sealed record GetCategoryByIdQuery(Guid CategoryId, Guid? UserId = null) : IQuery<Planora.BuildingBlocks.Domain.Result<CategoryDto>>;

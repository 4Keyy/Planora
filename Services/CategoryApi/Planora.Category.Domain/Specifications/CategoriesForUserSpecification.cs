using Planora.BuildingBlocks.Domain.Specifications;

namespace Planora.Category.Domain.Specifications;

public sealed class CategoriesForUserSpecification : BaseSpecification<Entities.Category>
{
    public CategoriesForUserSpecification(Guid userId, bool includeArchived = false)
        : base(c => c.UserId == userId && (includeArchived || !c.IsArchived))
    {
        ApplyOrderBy(c => c.Order);
    }
}
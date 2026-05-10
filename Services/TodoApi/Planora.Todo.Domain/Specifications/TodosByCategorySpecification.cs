using Planora.BuildingBlocks.Domain.Specifications;

namespace Planora.Todo.Domain.Specifications
{
    public sealed class TodosByCategorySpecification : BaseSpecification<Entities.TodoItem>
    {
        public TodosByCategorySpecification(Guid userId, Guid categoryId)
            : base(x => x.UserId == userId &&
                        x.CategoryId == categoryId &&
                        !x.IsDeleted)
        {
            AddInclude(x => x.Tags);
            ApplyOrderBy(x => x.Priority);
        }
    }
}

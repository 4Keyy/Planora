using Planora.BuildingBlocks.Domain.Specifications;

namespace Planora.Todo.Domain.Specifications
{
    public sealed class ActiveTodosForUserSpecification : BaseSpecification<Entities.TodoItem>
    {
        public ActiveTodosForUserSpecification(Guid userId)
            : base(x => x.UserId == userId && !x.IsDeleted)
        {
            AddInclude(x => x.Tags);
            ApplyOrderByDescending(x => x.CreatedAt);
        }
    }
}

using Planora.BuildingBlocks.Domain.Specifications;

namespace Planora.Todo.Domain.Specifications
{
    public sealed class CompletedTodosForUserSpecification : BaseSpecification<Entities.TodoItem>
    {
        public CompletedTodosForUserSpecification(Guid userId, int days = 7)
            : base(x => x.UserId == userId &&
                        x.IsCompleted &&
                        !x.IsDeleted &&
                        x.CompletedAt.HasValue &&
                        x.CompletedAt.Value >= DateTime.UtcNow.AddDays(-days))
        {
            AddInclude(x => x.Tags);
            ApplyOrderByDescending(x => x.CompletedAt ?? DateTime.MinValue);
        }
    }
}

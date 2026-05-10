using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.Todo.Infrastructure.Persistence.Repositories
{
    public sealed class TodoItemRepository : BaseRepository<TodoItem, Guid, TodoDbContext>, IRepository<TodoItem>
    {
        public TodoItemRepository(TodoDbContext context) : base(context) { }
    }
}

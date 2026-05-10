namespace Planora.Todo.Domain.Entities
{
    public sealed class TodoItemShare
    {
        public Guid TodoItemId { get; set; }
        public Guid SharedWithUserId { get; set; }
    }
}

namespace Planora.Todo.Domain.Entities
{
    public sealed class TodoItemWorker
    {
        public Guid TodoItemId { get; set; }
        public Guid UserId { get; set; }
        public DateTime JoinedAt { get; set; }
    }
}

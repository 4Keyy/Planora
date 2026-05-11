namespace Planora.Todo.Domain.Entities
{
    public sealed class UserTodoViewPreference
    {
        public Guid ViewerId { get; set; }
        public Guid TodoItemId { get; set; }
        public bool HiddenByViewer { get; set; }
        public Guid? ViewerCategoryId { get; set; }
        public bool CompletedByViewer { get; set; }
        public DateTime? CompletedByViewerAt { get; set; }
    }
}

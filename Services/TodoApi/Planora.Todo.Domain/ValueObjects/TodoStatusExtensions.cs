using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Domain.ValueObjects
{
    public static class TodoStatusExtensions
    {
        public static string Display(this TodoStatus status) => status switch
        {
            TodoStatus.Todo => "Todo",
            TodoStatus.InProgress => "In Progress",
            TodoStatus.Done => "Done",
            _ => "Unknown"
        };

        public static TodoStatus? FromString(string? value) => value?.ToLowerInvariant().Replace(" ", "") switch
        {
            "todo" => TodoStatus.Todo,
            "pending" => TodoStatus.Todo,
            "inprogress" => TodoStatus.InProgress,
            "done" => TodoStatus.Done,
            "completed" => TodoStatus.Done,
            _ => null
        };
    }
}

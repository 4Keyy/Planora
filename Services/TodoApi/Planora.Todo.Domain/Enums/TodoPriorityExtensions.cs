namespace Planora.Todo.Domain.Enums
{
    public static class TodoPriorityExtensions
    {
        public static string Display(this TodoPriority priority) => priority switch
        {
            TodoPriority.VeryLow => "Very Low",
            TodoPriority.Low => "Low",
            TodoPriority.Medium => "Medium",
            TodoPriority.High => "High",
            TodoPriority.Urgent => "Urgent",
            _ => "Unknown"
        };

        public static TodoPriority FromInt(int value) => value switch
        {
            1 => TodoPriority.VeryLow,
            2 => TodoPriority.Low,
            3 => TodoPriority.Medium,
            4 => TodoPriority.High,
            5 => TodoPriority.Urgent,
            _ => throw new ArgumentException($"Invalid priority value: {value}. Must be between 1 and 5.")
        };
    }
}


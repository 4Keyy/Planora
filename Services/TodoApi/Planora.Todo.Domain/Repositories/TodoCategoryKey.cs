namespace Planora.Todo.Domain.Repositories
{
    /// <summary>
    /// The three columns a per-category tally needs from a task: its id (to look up the caller's
    /// own category for someone else's shared task), its owner and the owner's category.
    /// </summary>
    public readonly record struct TodoCategoryKey(Guid Id, Guid UserId, Guid? CategoryId);
}

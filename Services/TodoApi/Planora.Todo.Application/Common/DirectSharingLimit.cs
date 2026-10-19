using Planora.BuildingBlocks.Domain;

namespace Planora.Todo.Application.Common;

public static class DirectSharingLimit
{
    public static readonly string Message = $"A task can be shared with at most {TodoItem.MaxSharedUsers} friends";
    public static readonly Error Exceeded = Error.Validation("TOO_MANY_SHARED_USERS", Message);

    public static bool IsExceeded(IEnumerable<Guid>? userIds)
        => userIds?.Where(id => id != Guid.Empty).Distinct().Skip(TodoItem.MaxSharedUsers).Any() == true;
}

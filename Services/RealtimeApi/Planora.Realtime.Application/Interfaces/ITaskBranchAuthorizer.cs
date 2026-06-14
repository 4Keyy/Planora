namespace Planora.Realtime.Application.Interfaces
{
    /// <summary>
    /// Decides whether a user may join a task's branch room. TodoApi owns the task aggregate and
    /// its ownership / sharing / public + friendship rules, so this delegates to it over gRPC
    /// (reusing <c>CheckTaskCommentAccess</c>) and never reads another service's database.
    /// Fails closed: any error resolves to "no access", so a room is never joined unauthorized.
    /// </summary>
    public interface ITaskBranchAuthorizer
    {
        Task<bool> CanAccessBranchAsync(Guid taskId, Guid userId, CancellationToken cancellationToken = default);
    }
}

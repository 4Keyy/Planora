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

        /// <summary>
        /// Returns the current content audience when the requester still has access. An empty
        /// audience is an authoritative denial; null means the authority is unavailable. Neither
        /// permits delivery, but an outage must not permanently evict an otherwise valid member.
        /// </summary>
        Task<IReadOnlyList<Guid>?> GetAudienceAsync(Guid taskId, Guid requesterId, CancellationToken cancellationToken = default);
    }
}

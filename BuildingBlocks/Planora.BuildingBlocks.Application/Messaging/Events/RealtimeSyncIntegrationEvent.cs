namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    /// <summary>
    /// Stable string discriminators for a <see cref="RealtimeSyncIntegrationEvent.Action"/>.
    /// Sent on the wire as strings (not enum ordinals) so the contract survives independent
    /// service deployments. The client treats unknown actions as a generic "something changed,
    /// reconcile" signal, so adding a new value never breaks an older frontend.
    /// </summary>
    public static class RealtimeSyncAction
    {
        // ── Feed-scope (a card in the tasks/dashboard lists) ─────────────────────────
        public const string TaskCreated = "task.created";
        public const string TaskUpdated = "task.updated";
        public const string TaskDeleted = "task.deleted";
        public const string TaskCompleted = "task.completed";
        public const string TaskReopened = "task.reopened";

        // ── Branch-scope (the open branch room of a task) ────────────────────────────
        public const string CommentAdded = "comment.added";
        public const string CommentUpdated = "comment.updated";
        public const string CommentDeleted = "comment.deleted";
        public const string SubtaskChanged = "subtask.changed";
        public const string BranchActivity = "branch.activity";
    }

    /// <summary>
    /// The single fan-out contract that drives every live UI update. Producers (TodoApi,
    /// CollaborationApi) emit it through their transactional outbox in the same unit of work as
    /// the mutation (INV-COMM-3); RealtimeApi consumes it and pushes the change over SignalR.
    ///
    /// One event can target two independent surfaces at once:
    ///   • <b>Feed</b> — when <see cref="AudienceUserIds"/> is non-empty, RealtimeApi pushes a
    ///     <c>TaskFeedChanged</c> message to each recipient's personal group so their task list /
    ///     dashboard reconciles. The producer is responsible for computing the exact audience
    ///     (owner + accepted friends when public + explicitly shared-with users) so RealtimeApi
    ///     never needs to know the visibility model — this keeps authorization where the data lives.
    ///   • <b>Branch</b> — when <see cref="BranchTaskId"/> is non-empty, RealtimeApi pushes a
    ///     <c>BranchChanged</c> message to the task's branch room (<c>task:{id}</c>). Room
    ///     membership is authorized at join time, so the event itself carries no audience.
    ///
    /// The payload is intentionally a thin <i>signal</i> (ids + action), never the full entity:
    /// the client refetches through the normal authorized endpoints to reconcile, so a stale or
    /// forged signal can never leak content a user is not allowed to read.
    /// </summary>
    public sealed class RealtimeSyncIntegrationEvent : IntegrationEvent
    {
        /// <summary>One of <see cref="RealtimeSyncAction"/>.</summary>
        public string Action { get; init; } = string.Empty;

        /// <summary>The entity the action is about — the task id (feed) or the comment/subtask/task id (branch).</summary>
        public Guid EntityId { get; init; }

        /// <summary>
        /// The branch room to notify (<c>task:{id}</c>). For a subtask change this is the PARENT
        /// task, whose branch shows the subtask. <see cref="System.Guid.Empty"/> means "no branch push".
        /// </summary>
        public Guid BranchTaskId { get; init; }

        /// <summary>Who triggered the change — lets a client ignore its own echo to preserve optimistic UI.</summary>
        public Guid ActorId { get; init; }

        /// <summary>
        /// Feed recipients (owner + friends when public + shared-with). Empty means "no feed push".
        /// On a visibility-narrowing update the producer includes the FORMER audience too, so users
        /// who just lost access receive the signal and drop the card.
        /// </summary>
        public IReadOnlyList<Guid> AudienceUserIds { get; init; } = System.Array.Empty<Guid>();

        public RealtimeSyncIntegrationEvent(
            string action,
            Guid entityId,
            Guid actorId,
            Guid branchTaskId = default,
            IReadOnlyList<Guid>? audienceUserIds = null)
        {
            Action = action;
            EntityId = entityId;
            ActorId = actorId;
            BranchTaskId = branchTaskId;
            AudienceUserIds = audienceUserIds ?? System.Array.Empty<Guid>();
        }
    }
}

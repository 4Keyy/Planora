namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    /// <summary>
    /// Raised by TodoApi when a single subtask is deleted. A subtask owns no branch of its own —
    /// its only timeline footprint is the system comments it left in the PARENT task's branch
    /// ("X added a subtask: …" / "X completed a subtask: …"). Collaboration consumes this and
    /// soft-deletes exactly those announcement comments so the parent's branch stays clean. The
    /// subtask title is carried so the consumer can match the deterministic sentence suffix
    /// (the comment store keeps no structural link back to the subtask aggregate).
    ///
    /// Note: deleting a whole parent task instead emits <see cref="TaskDeletedIntegrationEvent"/>,
    /// which removes the entire branch (including any subtask announcements) in one shot.
    /// </summary>
    public sealed class SubtaskDeletedIntegrationEvent : IntegrationEvent
    {
        /// <summary>The parent task whose branch carries the announcement comments.</summary>
        public Guid ParentTaskId { get; init; }

        /// <summary>The deleted subtask's id (diagnostic / future correlation).</summary>
        public Guid SubtaskId { get; init; }

        public Guid ActorId { get; init; }

        /// <summary>The deleted subtask's title — matches the system-comment sentence suffix.</summary>
        public string Title { get; init; } = string.Empty;

        public SubtaskDeletedIntegrationEvent(Guid parentTaskId, Guid subtaskId, Guid actorId, string title)
        {
            ParentTaskId = parentTaskId;
            SubtaskId = subtaskId;
            ActorId = actorId;
            Title = title;
        }
    }
}

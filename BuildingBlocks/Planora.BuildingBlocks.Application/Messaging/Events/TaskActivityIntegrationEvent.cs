namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    /// <summary>
    /// Stable string discriminators for the kinds of task lifecycle activity that surface as
    /// system comments in the Collaboration timeline. Sent on the wire as strings (not an enum
    /// ordinal) so the contract stays robust across independent service deployments.
    /// </summary>
    public static class TaskActivityType
    {
        public const string Completed = "Completed";
        public const string StartedWorking = "StartedWorking";
        public const string Left = "Left";

        // Subtask lifecycle surfaced in the PARENT task's branch (TaskId = parent id;
        // Detail = subtask title).
        public const string SubtaskCreated = "SubtaskCreated";
        public const string SubtaskCompleted = "SubtaskCompleted";
    }

    /// <summary>
    /// Raised by TodoApi on task lifecycle transitions (owner completes/starts/stops, worker
    /// joins/leaves) and subtask create/complete. Consumed by the Collaboration service to append a
    /// system comment to the task's activity timeline. The sentence template lives in the consumer;
    /// this event only carries the structured fact plus the actor's display name (freshest at
    /// publish time) and an optional <see cref="Detail"/> (e.g. the subtask title).
    /// </summary>
    public sealed class TaskActivityIntegrationEvent : IntegrationEvent
    {
        public Guid TaskId { get; init; }
        public Guid ActorId { get; init; }
        public string ActorName { get; init; } = string.Empty;

        /// <summary>One of <see cref="TaskActivityType"/>.</summary>
        public string ActivityType { get; init; } = string.Empty;

        /// <summary>Optional context for the sentence, e.g. the subtask title. Null for plain task events.</summary>
        public string? Detail { get; init; }

        public TaskActivityIntegrationEvent(Guid taskId, Guid actorId, string actorName, string activityType, string? detail = null)
        {
            TaskId = taskId;
            ActorId = actorId;
            ActorName = actorName;
            ActivityType = activityType;
            Detail = detail;
        }
    }
}

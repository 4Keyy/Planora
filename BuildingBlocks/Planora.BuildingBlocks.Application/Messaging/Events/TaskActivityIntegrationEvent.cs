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
    }

    /// <summary>
    /// Raised by TodoApi on task lifecycle transitions (owner completes/starts/stops, worker
    /// joins/leaves). Consumed by the Collaboration service to append a system comment to the
    /// task's activity timeline. The sentence template lives in the consumer; this event only
    /// carries the structured fact plus the actor's display name (freshest at publish time).
    /// </summary>
    public sealed class TaskActivityIntegrationEvent : IntegrationEvent
    {
        public Guid TaskId { get; init; }
        public Guid ActorId { get; init; }
        public string ActorName { get; init; } = string.Empty;

        /// <summary>One of <see cref="TaskActivityType"/>.</summary>
        public string ActivityType { get; init; } = string.Empty;

        public TaskActivityIntegrationEvent(Guid taskId, Guid actorId, string actorName, string activityType)
        {
            TaskId = taskId;
            ActorId = actorId;
            ActorName = actorName;
            ActivityType = activityType;
        }
    }
}

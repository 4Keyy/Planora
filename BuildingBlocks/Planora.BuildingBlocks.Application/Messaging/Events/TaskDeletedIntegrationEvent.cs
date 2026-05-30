namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    /// <summary>
    /// Raised by TodoApi when a task is deleted. Replaces the former in-process cascade
    /// (TodoApi used to soft-delete the comment rows in the same transaction). The
    /// Collaboration service consumes this and soft-deletes every comment for the task,
    /// keeping the activity timeline consistent with task lifetime via eventual consistency.
    /// </summary>
    public sealed class TaskDeletedIntegrationEvent : IntegrationEvent
    {
        public Guid TaskId { get; init; }
        public Guid ActorId { get; init; }

        public TaskDeletedIntegrationEvent(Guid taskId, Guid actorId)
        {
            TaskId = taskId;
            ActorId = actorId;
        }
    }
}

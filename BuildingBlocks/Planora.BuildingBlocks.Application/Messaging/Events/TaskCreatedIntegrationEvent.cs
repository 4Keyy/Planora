namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    /// <summary>
    /// Raised by TodoApi when a task is created. Consumed by the Collaboration service to
    /// materialise the task's genesis comment (when a description was provided) and the
    /// "{owner} created the task" system comment in the activity timeline ("ветка").
    /// </summary>
    public sealed class TaskCreatedIntegrationEvent : IntegrationEvent
    {
        public Guid TaskId { get; init; }
        public Guid OwnerId { get; init; }
        public string OwnerName { get; init; } = string.Empty;
        public string? Description { get; init; }

        public TaskCreatedIntegrationEvent(Guid taskId, Guid ownerId, string ownerName, string? description)
        {
            TaskId = taskId;
            OwnerId = ownerId;
            OwnerName = ownerName;
            Description = description;
        }
    }
}

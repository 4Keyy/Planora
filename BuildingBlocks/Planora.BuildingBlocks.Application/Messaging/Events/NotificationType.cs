namespace Planora.BuildingBlocks.Application.Messaging.Events
{
    /// <summary>
    /// Stable string discriminators for <see cref="NotificationEvent.Type"/>. Sent on the wire as
    /// strings (not enum ordinals) so the contract survives independent service deployments, and the
    /// frontend maps each to an icon / tint / OS-notification policy. The client treats an unknown
    /// type as a generic notification, so adding a value never breaks an older frontend.
    /// </summary>
    public static class NotificationType
    {
        // ── Branch activity ──────────────────────────────────────────────────────────
        /// <summary>A new message was posted in a task's branch.</summary>
        public const string CommentAdded = "comment.added";
        /// <summary>Someone replied directly to the recipient's message or subtask.</summary>
        public const string CommentReply = "comment.reply";
        /// <summary>A new subtask was added to a task.</summary>
        public const string SubtaskAdded = "subtask.added";
        /// <summary>A subtask was marked complete.</summary>
        public const string SubtaskCompleted = "subtask.completed";
        /// <summary>Someone took the task into work.</summary>
        public const string TaskStarted = "task.started";
        /// <summary>A collaborator completed a public / shared task.</summary>
        public const string TaskCompleted = "task.completed";

        // ── Author-only review signals ───────────────────────────────────────────────
        /// <summary>
        /// Every participant (except the author) has completed the task AND every subtask is done —
        /// the task is ready for the author's review.
        /// </summary>
        public const string TaskReview = "task.review";
        /// <summary>
        /// Every participant (except the author) has completed the task, but some subtasks remain —
        /// shown with the "people + check" mark.
        /// </summary>
        public const string TaskParticipantsDone = "task.participants_done";
    }
}

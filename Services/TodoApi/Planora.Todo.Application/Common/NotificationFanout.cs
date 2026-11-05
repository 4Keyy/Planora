using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Todo.Application.Common
{
    /// <summary>
    /// Fans a per-user <see cref="NotificationEvent"/> out to every recipient <b>except the actor</b>
    /// through the service outbox. StageAsync joins the mutation's unit of work (INV-COMM-3);
    /// EnqueueAsync retains immediate per-recipient saves for legacy callers. The actor never
    /// gets notified about their own action — the rule that keeps "I took this task into work" from
    /// lighting my own card. Content recipients come from <c>RealtimeAudience.ResolveContentAsync(...)</c>
    /// (owner + currently accepted friends who have stored access, with the fallback only on legacy rows).
    /// De-duplication and the actor/empty filter happen here.
    /// </summary>
    internal static class NotificationFanout
    {
        public static Task EnqueueAsync(
            IOutboxRepository outbox,
            IEnumerable<Guid> recipients,
            Guid actorId,
            Guid taskId,
            string type,
            string title,
            string message,
            CancellationToken cancellationToken) =>
            WriteAsync(outbox, recipients, actorId, taskId, type, title, message, cancellationToken, stage: false);

        public static Task StageAsync(
            IOutboxRepository outbox,
            IEnumerable<Guid> recipients,
            Guid actorId,
            Guid taskId,
            string type,
            string title,
            string message,
            CancellationToken cancellationToken) =>
            WriteAsync(outbox, recipients, actorId, taskId, type, title, message, cancellationToken, stage: true);

        private static async Task WriteAsync(
            IOutboxRepository outbox,
            IEnumerable<Guid> recipients,
            Guid actorId,
            Guid taskId,
            string type,
            string title,
            string message,
            CancellationToken cancellationToken,
            bool stage)
        {
            var seen = new HashSet<Guid>();
            foreach (var recipientId in recipients)
            {
                // Exclude the actor (no self-notification), empties, and duplicates.
                if (recipientId == Guid.Empty || recipientId == actorId || !seen.Add(recipientId))
                    continue;

                var notification = new NotificationEvent(recipientId, title, message, type, taskId, actorId);
                if (stage)
                    await outbox.StageIntegrationEventAsync(notification, cancellationToken);
                else
                    await outbox.EnqueueIntegrationEventAsync(notification, cancellationToken);
            }
        }

        /// <summary>Trims a task/subtask title to a compact preview for a notification body.</summary>
        public static string TitlePreview(string? title, int max = 60)
        {
            if (string.IsNullOrWhiteSpace(title))
                return "a task";

            title = title.Trim();
            return title.Length <= max ? title : title[..(max - 1)] + "…";
        }
    }
}

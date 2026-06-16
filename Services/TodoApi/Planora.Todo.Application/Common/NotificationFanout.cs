using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Todo.Application.Common
{
    /// <summary>
    /// Fans a per-user <see cref="NotificationEvent"/> out to every recipient <b>except the actor</b>
    /// through the service outbox (same unit of work as the mutation, INV-COMM-3). The actor never
    /// gets notified about their own action — the rule that keeps "I took this task into work" from
    /// lighting my own card. Recipients are typically <c>RealtimeAudience.ResolveAsync(...)</c> (owner
    /// + shared-with + public friends); de-duplication and the actor/empty filter happen here so call
    /// sites stay a single line.
    /// </summary>
    internal static class NotificationFanout
    {
        public static async Task EnqueueAsync(
            IOutboxRepository outbox,
            IEnumerable<Guid> recipients,
            Guid actorId,
            Guid taskId,
            string type,
            string title,
            string message,
            CancellationToken cancellationToken)
        {
            var seen = new HashSet<Guid>();
            foreach (var recipientId in recipients)
            {
                // Exclude the actor (no self-notification), empties, and duplicates.
                if (recipientId == Guid.Empty || recipientId == actorId || !seen.Add(recipientId))
                    continue;

                await outbox.EnqueueIntegrationEventAsync(
                    new NotificationEvent(recipientId, title, message, type, taskId, actorId),
                    cancellationToken);
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

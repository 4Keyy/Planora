using System.Text.Json;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Todo.Application.Common
{
    /// <summary>
    /// Writes integration events into the service outbox inside the caller's unit of work
    /// (INV-COMM-3). The shared <see cref="OutboxProcessor"/> ships them to RabbitMQ. Used by
    /// the task lifecycle handlers to drive the Collaboration timeline ("ветки") instead of the
    /// former in-process comment writes.
    /// </summary>
    internal static class OutboxExtensions
    {
        /// <summary>Tracks an event for the caller's final SaveChangesAsync.</summary>
        public static Task StageIntegrationEventAsync(
            this IOutboxRepository outbox,
            IntegrationEvent integrationEvent,
            CancellationToken cancellationToken) =>
            outbox.StageAsync(CreateMessage(integrationEvent), cancellationToken);

        /// <summary>Saves the event immediately with any other pending changes.</summary>
        public static Task EnqueueIntegrationEventAsync(
            this IOutboxRepository outbox,
            IntegrationEvent integrationEvent,
            CancellationToken cancellationToken) =>
            outbox.AddAsync(CreateMessage(integrationEvent), cancellationToken);

        private static OutboxMessage CreateMessage(IntegrationEvent integrationEvent) =>
            new(
                integrationEvent.GetType().AssemblyQualifiedName ?? integrationEvent.GetType().Name,
                JsonSerializer.Serialize(integrationEvent, integrationEvent.GetType()),
                DateTime.UtcNow);
    }
}

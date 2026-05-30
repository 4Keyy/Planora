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
        public static Task EnqueueIntegrationEventAsync(
            this IOutboxRepository outbox,
            IntegrationEvent integrationEvent,
            CancellationToken cancellationToken)
        {
            var message = new OutboxMessage(
                integrationEvent.GetType().AssemblyQualifiedName ?? integrationEvent.GetType().Name,
                JsonSerializer.Serialize(integrationEvent, integrationEvent.GetType()),
                DateTime.UtcNow);

            return outbox.AddAsync(message, cancellationToken);
        }
    }
}

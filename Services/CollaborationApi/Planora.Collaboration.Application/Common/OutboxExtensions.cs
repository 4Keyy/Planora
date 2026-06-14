using System.Text.Json;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;

namespace Planora.Collaboration.Application.Common
{
    /// <summary>
    /// Writes integration events into the Collaboration outbox so the shared OutboxProcessor ships
    /// them to RabbitMQ (INV-COMM-3). Mirrors TodoApi's helper so both producers serialize the
    /// envelope identically — the assembly-qualified type name lets each consumer resolve the
    /// concrete event type on the other side of the bus.
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

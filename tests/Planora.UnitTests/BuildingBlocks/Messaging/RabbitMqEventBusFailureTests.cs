using System.Text.Json;
using Planora.BuildingBlocks.Infrastructure.Messaging;

namespace Planora.UnitTests.BuildingBlocks.Messaging;

public class RabbitMqEventBusFailureTests
{
    [Fact]
    public void PoisonPayload_IsDeadLettered_EvenOnFirstDelivery()
    {
        var action = RabbitMqEventBus.ClassifyFailure(new JsonException("bad json"), redelivered: false);

        Assert.Equal(RabbitMqEventBus.DeliveryFailureAction.DeadLetter, action);
    }

    [Fact]
    public void TransientFailure_OnFirstDelivery_IsRequeuedOnce()
    {
        var action = RabbitMqEventBus.ClassifyFailure(new InvalidOperationException("db blip"), redelivered: false);

        Assert.Equal(RabbitMqEventBus.DeliveryFailureAction.Requeue, action);
    }

    [Fact]
    public void TransientFailure_OnRedelivery_IsDeadLettered()
    {
        var action = RabbitMqEventBus.ClassifyFailure(new InvalidOperationException("still failing"), redelivered: true);

        Assert.Equal(RabbitMqEventBus.DeliveryFailureAction.DeadLetter, action);
    }

    [Fact]
    public void PoisonPayload_OnRedelivery_IsDeadLettered()
    {
        var action = RabbitMqEventBus.ClassifyFailure(new JsonException("bad json"), redelivered: true);

        Assert.Equal(RabbitMqEventBus.DeliveryFailureAction.DeadLetter, action);
    }

    // PLN-27: the inbox dedup key must be per (event id, handler) so a single event fanned out to
    // several handlers is processed once PER HANDLER, not suppressed after the first.
    [Fact]
    public void DeriveInboxKey_IsDeterministicForSameEventAndHandler()
    {
        var eventId = Guid.NewGuid();

        var first = RabbitMqEventBus.DeriveInboxKey(eventId, typeof(HandlerA));
        var second = RabbitMqEventBus.DeriveInboxKey(eventId, typeof(HandlerA));

        Assert.Equal(first, second);
        Assert.NotEqual(Guid.Empty, first);
    }

    [Fact]
    public void DeriveInboxKey_DiffersPerHandlerForSameEvent()
    {
        var eventId = Guid.NewGuid();

        var keyA = RabbitMqEventBus.DeriveInboxKey(eventId, typeof(HandlerA));
        var keyB = RabbitMqEventBus.DeriveInboxKey(eventId, typeof(HandlerB));

        Assert.NotEqual(keyA, keyB);
    }

    [Fact]
    public void DeriveInboxKey_DiffersPerEventForSameHandler()
    {
        var keyOne = RabbitMqEventBus.DeriveInboxKey(Guid.NewGuid(), typeof(HandlerA));
        var keyTwo = RabbitMqEventBus.DeriveInboxKey(Guid.NewGuid(), typeof(HandlerA));

        Assert.NotEqual(keyOne, keyTwo);
    }

    private sealed class HandlerA { }
    private sealed class HandlerB { }
}

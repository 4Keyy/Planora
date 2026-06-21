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
}

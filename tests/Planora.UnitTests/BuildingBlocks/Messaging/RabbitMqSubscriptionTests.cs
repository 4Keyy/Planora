using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using RabbitMQ.Client;

namespace Planora.UnitTests.BuildingBlocks.Messaging;

public sealed class RabbitMqSubscriptionTests
{
    [Fact]
    public async Task DifferentSubscribers_WithSameHandlerName_HaveIndependentQueues()
    {
        await using var fixture = new BusFixture();

        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");
        await Subscribe<TestEvent, Category.UserDeletedEventConsumer>(fixture.Bus, "category.user-deleted");

        Assert.Equal(new[] { "planora.todo.user-deleted.v1", "planora.category.user-deleted.v1" },
            fixture.Channels.SelectMany(c => c.Consumers.Select(x => x.Queue)));
    }

    [Fact]
    public async Task Replicas_UseTheSameLogicalQueue()
    {
        await using var first = new BusFixture();
        await using var second = new BusFixture();

        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(first.Bus, "todo.user-deleted");
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(second.Bus, "todo.user-deleted");

        Assert.Equal("planora.todo.user-deleted.v1", Assert.Single(first.Channels[0].Consumers).Queue);
        Assert.Equal(Assert.Single(first.Channels[0].Consumers).Queue,
            Assert.Single(second.Channels[0].Consumers).Queue);
    }

    [Fact]
    public async Task Subscription_DeclaresDurableQuorumDlqAndBindingBeforeConsumption()
    {
        await using var fixture = new BusFixture();

        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        var channel = Assert.Single(fixture.Channels);
        var dlq = Assert.Single(channel.Queues, q => q.Name == "planora.todo.user-deleted.v1.dlq");
        Assert.True(dlq.Durable);
        Assert.False(dlq.Exclusive);
        Assert.False(dlq.AutoDelete);
        Assert.Equal("quorum", dlq.Arguments["x-queue-type"]);
        var source = Assert.Single(channel.Queues, q => q.Name == "planora.todo.user-deleted.v1");
        Assert.True(source.Durable);
        Assert.False(source.Exclusive);
        Assert.False(source.AutoDelete);
        Assert.Equal("quorum", source.Arguments["x-queue-type"]);
        Assert.Equal("planora-eventbus-dlx", source.Arguments["x-dead-letter-exchange"]);
        Assert.Equal(source.Name, source.Arguments["x-dead-letter-routing-key"]);
        Assert.Equal("at-least-once", source.Arguments["x-dead-letter-strategy"]);
        Assert.Equal("reject-publish", source.Arguments["x-overflow"]);
        Assert.Contains(channel.Bindings, b => b == (dlq.Name, "planora-eventbus-dlx", source.Name));
        Assert.Contains(channel.Bindings, b => b == (source.Name, "planora-eventbus", nameof(TestEvent)));
        Assert.True(channel.Actions.IndexOf("bind:" + dlq.Name) < channel.Actions.IndexOf("consume"));
    }

    [Fact]
    public async Task FailedSubscription_CanBeRetriedAndDisposesTheFailedChannel()
    {
        await using var fixture = new BusFixture();
        fixture.FailFirstDeclaration = true;

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted"));
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        Assert.Equal(2, fixture.Channels.Count);
        Assert.True(fixture.Channels[0].Disposed);
        Assert.Single(fixture.Channels[1].Consumers);
    }

    [Fact]
    public async Task Delivery_DispatchesOnlyItsSubscriptionsHandler()
    {
        await using var fixture = new BusFixture();
        var todo = new Todo.UserDeletedEventConsumer();
        var category = new Category.UserDeletedEventConsumer();
        fixture.Services.AddSingleton(todo).AddSingleton(category);
        fixture.BuildProvider();
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");
        await Subscribe<TestEvent, Category.UserDeletedEventConsumer>(fixture.Bus, "category.user-deleted");

        await Deliver(fixture.Channels[0], JsonSerializer.SerializeToUtf8Bytes(new TestEvent()));

        Assert.Equal(1, todo.Deliveries);
        Assert.Equal(0, category.Deliveries);
        fixture.Channels[0].Mock.Verify(c => c.BasicAckAsync(1, false, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task MissingHandler_IsRetriedWithoutAcknowledging()
    {
        await using var fixture = new BusFixture();
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        await Deliver(fixture.Channels[0], JsonSerializer.SerializeToUtf8Bytes(new TestEvent()));

        fixture.Channels[0].Mock.Verify(c => c.BasicAckAsync(It.IsAny<ulong>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.Channels[0].Mock.Verify(c => c.BasicNackAsync(1, false, true, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("null")]
    [InlineData("{broken")]
    public async Task PoisonPayload_IsDeadLetteredWithoutAcknowledging(string payload)
    {
        await using var fixture = new BusFixture();
        fixture.Services.AddSingleton<Todo.UserDeletedEventConsumer>();
        fixture.BuildProvider();
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        await Deliver(fixture.Channels[0], Encoding.UTF8.GetBytes(payload));

        fixture.Channels[0].Mock.Verify(c => c.BasicAckAsync(It.IsAny<ulong>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()), Times.Never);
        fixture.Channels[0].Mock.Verify(c => c.BasicNackAsync(1, false, false, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData("")]
    [InlineData("Todo.user-deleted")]
    [InlineData("todo.*")]
    [InlineData("todo..deleted")]
    [InlineData("todo/deleted")]
    public async Task InvalidSubscriptionId_IsRejectedBeforeConnecting(string subscriptionId)
    {
        await using var fixture = new BusFixture();

        await Assert.ThrowsAnyAsync<ArgumentException>(() =>
            Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, subscriptionId));

        Assert.Empty(fixture.Channels);
    }

    [Fact]
    public async Task ExistingSubscriptionId_CannotBeReassignedToAnotherHandler()
    {
        await using var fixture = new BusFixture();
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            Subscribe<TestEvent, Category.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted"));

        Assert.Single(fixture.Channels);
    }

    [Fact]
    public async Task DuplicateSubscription_IsIdempotentWithinOneBus()
    {
        await using var fixture = new BusFixture();

        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        Assert.Single(fixture.Channels);
        Assert.Single(fixture.Channels[0].Consumers);
    }

    [Fact]
    public async Task CanceledSubscription_DoesNotConnectOrRegister()
    {
        await using var fixture = new BusFixture();
        using var canceled = new CancellationTokenSource();
        canceled.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted", canceled.Token));
        Assert.Empty(fixture.Channels);
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");
        Assert.Single(fixture.Channels);
    }

    [Fact]
    public async Task ConcurrentDuplicateSubscriptions_CreateOneConsumer()
    {
        await using var fixture = new BusFixture();
        fixture.ConnectionGate = new(TaskCreationOptions.RunContinuationsAsynchronously);

        var subscriptions = Enumerable.Range(0, 8).Select(_ =>
            Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted")).ToArray();
        Assert.All(subscriptions, subscription => Assert.False(subscription.IsCompleted));
        fixture.ConnectionGate.SetResult();
        await Task.WhenAll(subscriptions);

        Assert.Single(fixture.Channels);
        Assert.Single(fixture.Channels[0].Consumers);
    }

    [Fact]
    public async Task CancellationAfterConsume_DoesNotLeaveARegisteredSubscription()
    {
        await using var fixture = new BusFixture();
        using var canceled = new CancellationTokenSource();
        fixture.OnConsume = canceled.Cancel;

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted", canceled.Token));
        Assert.True(fixture.Channels[0].Disposed);
        fixture.OnConsume = null;
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        Assert.Equal(2, fixture.Channels.Count);
        Assert.Single(fixture.Channels[1].Consumers);
    }

    [Fact]
    public async Task Unsubscribe_RemovesOnlyTheExactSubscription_AndAllowsResubscribe()
    {
        await using var fixture = new BusFixture();
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");
        await Subscribe<TestEvent, Category.UserDeletedEventConsumer>(fixture.Bus, "category.user-deleted");

        await fixture.Bus.UnsubscribeAsync<TestEvent, Todo.UserDeletedEventConsumer>("todo.user-deleted");

        Assert.True(fixture.Channels[0].Disposed);
        Assert.False(fixture.Channels[1].Disposed);
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");
        Assert.Equal(3, fixture.Channels.Count);
    }

    [Fact]
    public async Task Unsubscribe_WithMismatchedHandler_DoesNotRemoveAnotherSubscription()
    {
        await using var fixture = new BusFixture();
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fixture.Bus.UnsubscribeAsync<TestEvent, Category.UserDeletedEventConsumer>("todo.user-deleted"));

        Assert.False(fixture.Channels[0].Disposed);
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");
        Assert.Single(fixture.Channels);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Disposal_ClosesSubscriptionsAndRejectsFurtherOperations(bool synchronous)
    {
        await using var fixture = new BusFixture();
        await Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted");

        if (synchronous) fixture.Bus.Dispose();
        else await fixture.Bus.DisposeAsync();

        Assert.True(fixture.Channels[0].Disposed);
        await Assert.ThrowsAsync<ObjectDisposedException>(() =>
            Subscribe<TestEvent, Todo.UserDeletedEventConsumer>(fixture.Bus, "todo.user-deleted"));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => fixture.Bus.PublishAsync(new TestEvent()));
        await Assert.ThrowsAsync<ObjectDisposedException>(() => fixture.Bus.EnsureConnectionAsync());
        await Assert.ThrowsAsync<ObjectDisposedException>(() =>
            fixture.Bus.UnsubscribeAsync<TestEvent, Todo.UserDeletedEventConsumer>("todo.user-deleted"));
        Assert.Single(fixture.Channels);
    }

    private static Task Deliver(RecordingChannel channel, byte[] body) => Assert.Single(channel.Consumers).Consumer
        .HandleBasicDeliverAsync("test", 1, false, "planora-eventbus", nameof(TestEvent), new BasicProperties(), body, CancellationToken.None);

    private static Task Subscribe<TEvent, THandler>(RabbitMqEventBus bus, string id, CancellationToken cancellationToken = default)
        where TEvent : IntegrationEvent
        where THandler : IIntegrationEventHandler<TEvent> => bus.SubscribeAsync<TEvent, THandler>(id, cancellationToken);

    private sealed class BusFixture : IAsyncDisposable
    {
        private ServiceProvider? _provider;
        private RabbitMqEventBus? _bus;
        private readonly Mock<IConnection> _connection = new();
        private readonly Mock<IRabbitMqConnectionManager> _manager = new();
        public ServiceCollection Services { get; } = new();
        public List<RecordingChannel> Channels { get; } = new();
        public bool FailFirstDeclaration { get; set; }
        public Action? OnConsume { get; set; }
        public TaskCompletionSource? ConnectionGate { get; set; }
        public RabbitMqEventBus Bus => _bus ??= new(_manager.Object, NullLogger<RabbitMqEventBus>.Instance,
            _provider ??= Services.BuildServiceProvider());

        public BusFixture()
        {
            _manager.Setup(m => m.GetConnectionAsync(It.IsAny<CancellationToken>())).Returns((CancellationToken token) =>
            {
                token.ThrowIfCancellationRequested();
                return Task.FromResult(_connection.Object);
            });
            _connection.Setup(c => c.CreateChannelAsync(It.IsAny<CreateChannelOptions>(), It.IsAny<CancellationToken>()))
                .Returns(async () =>
                {
                    var channel = new RecordingChannel(Channels.Count == 0 && FailFirstDeclaration, OnConsume);
                    Channels.Add(channel);
                    if (ConnectionGate is not null) await ConnectionGate.Task;
                    return channel.Mock.Object;
                });
        }

        public void BuildProvider() => _provider = Services.BuildServiceProvider();

        public async ValueTask DisposeAsync()
        {
            if (_bus is not null) await _bus.DisposeAsync();
            if (_provider is not null) await _provider.DisposeAsync();
        }
    }

    private sealed record QueueDeclaration(string Name, bool Durable, bool Exclusive, bool AutoDelete, IDictionary<string, object?> Arguments);

    private sealed class RecordingChannel
    {
        public Mock<IChannel> Mock { get; } = new();
        public List<QueueDeclaration> Queues { get; } = new();
        public List<(string Queue, string Exchange, string RoutingKey)> Bindings { get; } = new();
        public List<(string Queue, IAsyncBasicConsumer Consumer)> Consumers { get; } = new();
        public List<string> Actions { get; } = new();
        public bool Disposed { get; private set; }

        public RecordingChannel(bool failDeclaration, Action? onConsume)
        {
            Mock.SetupGet(c => c.IsOpen).Returns(true);
            Mock.Setup(c => c.QueueDeclareAsync(It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<bool>(), It.IsAny<bool>(),
                    It.IsAny<IDictionary<string, object?>>(), It.IsAny<bool>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
                .Returns((string name, bool durable, bool exclusive, bool autoDelete, IDictionary<string, object?> arguments, bool passive, bool noWait, CancellationToken token) =>
                {
                    if (failDeclaration) throw new InvalidOperationException("synthetic declaration failure");
                    Queues.Add(new(name, durable, exclusive, autoDelete, arguments));
                    Actions.Add("declare:" + name);
                    return Task.FromResult(new QueueDeclareOk(name, 0, 0));
                });
            Mock.Setup(c => c.QueueBindAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(),
                    It.IsAny<IDictionary<string, object?>>(), It.IsAny<bool>(), It.IsAny<CancellationToken>()))
                .Callback((string queue, string exchange, string routing, IDictionary<string, object?> arguments, bool noWait, CancellationToken token) =>
                {
                    Bindings.Add((queue, exchange, routing));
                    Actions.Add("bind:" + queue);
                }).Returns(Task.CompletedTask);
            Mock.Setup(c => c.BasicConsumeAsync(It.IsAny<string>(), It.IsAny<bool>(), It.IsAny<string>(), It.IsAny<bool>(),
                    It.IsAny<bool>(), It.IsAny<IDictionary<string, object?>>(), It.IsAny<IAsyncBasicConsumer>(), It.IsAny<CancellationToken>()))
                .Callback((string queue, bool autoAck, string tag, bool noLocal, bool exclusive, IDictionary<string, object?> arguments, IAsyncBasicConsumer consumer, CancellationToken token) =>
                {
                    Consumers.Add((queue, consumer));
                    Actions.Add("consume");
                    onConsume?.Invoke();
                }).ReturnsAsync("test-consumer");
            Mock.Setup(c => c.DisposeAsync()).Callback(() => Disposed = true).Returns(ValueTask.CompletedTask);
            Mock.Setup(c => c.Dispose()).Callback(() => Disposed = true);
        }
    }

    public sealed class TestEvent : IntegrationEvent;

    public static class Todo
    {
        public sealed class UserDeletedEventConsumer : IIntegrationEventHandler<TestEvent>
        {
            public int Deliveries { get; private set; }
            public Task HandleAsync(TestEvent @event, CancellationToken cancellationToken = default)
            {
                Deliveries++;
                return Task.CompletedTask;
            }
        }
    }

    public static class Category
    {
        public sealed class UserDeletedEventConsumer : IIntegrationEventHandler<TestEvent>
        {
            public int Deliveries { get; private set; }
            public Task HandleAsync(TestEvent @event, CancellationToken cancellationToken = default)
            {
                Deliveries++;
                return Task.CompletedTask;
            }
        }
    }
}

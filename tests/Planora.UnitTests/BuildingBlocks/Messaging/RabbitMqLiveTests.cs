using System.Collections.Concurrent;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Planora.Todo.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;
using RabbitMQ.Client;

namespace Planora.UnitTests.BuildingBlocks.Messaging;

public sealed class RabbitMqLiveTests
{
    [RabbitFact]
    public async Task OnePublish_ReachesThreeSubscribers_AndReplicasShareWork()
    {
        await using var fixture = await BrokerFixture.Connect();
        var prefix = "audit." + Guid.NewGuid().ToString("N");
        var first = new Effects();
        var second = new Effects();
        var third = new Effects();
        await using var a = fixture.CreateBus<DomainA.UserDeletedEventConsumer>(first);
        await using var replica = fixture.CreateBus<DomainA.UserDeletedEventConsumer>(first);
        await using var b = fixture.CreateBus<DomainB.UserDeletedEventConsumer>(second);
        await using var c = fixture.CreateBus<DomainC.UserDeletedEventConsumer>(third);
        await Subscribe<DeletedEvent, DomainA.UserDeletedEventConsumer>(a.Bus, prefix + ".todo");
        await Subscribe<DeletedEvent, DomainA.UserDeletedEventConsumer>(replica.Bus, prefix + ".todo");
        await Subscribe<DeletedEvent, DomainB.UserDeletedEventConsumer>(b.Bus, prefix + ".category");
        await Subscribe<DeletedEvent, DomainC.UserDeletedEventConsumer>(c.Bus, prefix + ".collaboration");

        var events = Enumerable.Range(0, 20).Select(_ => new DeletedEvent()).ToArray();
        foreach (var message in events)
            await a.Bus.PublishAsync(message);
        await Until(() => first.Count == 20 && second.Count == 20 && third.Count == 20,
            "One publish must reach every logical subscriber");
        Assert.Equal(20, first.Deliveries);
        Assert.Equal(20, second.Deliveries);
        Assert.Equal(20, third.Deliveries);
        foreach (var message in events)
            await a.Bus.PublishAsync(message);
        await Until(() => first.Deliveries + second.Deliveries + third.Deliveries >= 120,
            "Replay must reach each subscriber, including the shared replica queue");
        Assert.Equal(20, first.Count);
        Assert.Equal(20, second.Count);
        Assert.Equal(20, third.Count);
        Assert.Equal(40, first.Deliveries);
        Assert.Equal(40, second.Deliveries);
        Assert.Equal(40, third.Deliveries);
        await using var channel = await fixture.Connection.CreateChannelAsync();
        var queue = await channel.QueueDeclarePassiveAsync("planora." + prefix + ".todo.v1");
        Assert.Equal(2u, queue.ConsumerCount);
    }

    [RabbitFact]
    public async Task PoisonAndExhaustedRetry_AreQuarantined_WithOriginalIdentity()
    {
        await using var fixture = await BrokerFixture.Connect();
        var subscription = "audit." + Guid.NewGuid().ToString("N") + ".failure";
        var effects = new Effects();
        await using var bus = fixture.CreateBus<FailingHandler>(effects);
        await Subscribe<FailureEvent, FailingHandler>(bus.Bus, subscription);
        await using var channel = await fixture.Connection.CreateChannelAsync(
            new CreateChannelOptions(true, true));
        var message = new FailureEvent();
        await bus.Bus.PublishAsync(message);
        var queue = "planora." + subscription + ".v1";
        var failed = await Take(channel, queue + ".dlq");
        Assert.Equal(message.Id.ToString(), failed.BasicProperties.MessageId);
        Assert.Equal(2, effects.Deliveries);
        Assert.Equal(message.Id, JsonSerializer.Deserialize<FailureEvent>(failed.Body.Span)!.Id);
        Assert.True(failed.BasicProperties.Headers!.ContainsKey("x-death"));
        await channel.BasicAckAsync(failed.DeliveryTag, false);

        var poisonId = Guid.NewGuid().ToString();
        await channel.BasicPublishAsync("planora-eventbus", nameof(FailureEvent), true,
            new BasicProperties { Persistent = true, MessageId = poisonId }, Encoding.UTF8.GetBytes("{bad-json"));
        var poison = await Take(channel, queue + ".dlq");
        Assert.Equal(poisonId, poison.BasicProperties.MessageId);
        Assert.Equal("{bad-json", Encoding.UTF8.GetString(poison.Body.Span));
        Assert.Equal(2, effects.Deliveries);
        await channel.BasicAckAsync(poison.DeliveryTag, false);
        Assert.Null(await channel.BasicGetAsync(queue + ".dlq", true));
    }

    [RabbitFact]
    public async Task MandatoryUnroutablePublish_Throws_AndNextRoutedPublishRecovers()
    {
        await using var fixture = await BrokerFixture.Connect();
        await using var bus = fixture.CreateBus<DomainA.UserDeletedEventConsumer>(new Effects());
        await Assert.ThrowsAnyAsync<Exception>(() => bus.Bus.PublishAsync(new UnroutedEvent()));
        var effects = new Effects();
        await using var consumer = fixture.CreateBus<DomainA.UserDeletedEventConsumer>(effects);
        await Subscribe<DeletedEvent, DomainA.UserDeletedEventConsumer>(consumer.Bus,
            "audit." + Guid.NewGuid().ToString("N") + ".recovery");
        await bus.Bus.PublishAsync(new DeletedEvent());
        await Until(() => effects.Count == 1, "Publisher must recover after a returned mandatory publish");
    }

    [RabbitPostgresFact]
    public async Task UnroutablePublish_DoesNotMarkPersistedOutboxProcessed()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var fixture = await BrokerFixture.Connect();
        await using var bus = fixture.CreateBus<DomainA.UserDeletedEventConsumer>(new Effects());
        var message = new UnroutedEvent();
        var row = new OutboxMessage(typeof(UnroutedEvent).AssemblyQualifiedName!,
            JsonSerializer.Serialize(message), message.OccurredOn);
        await using (var seed = new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await seed.Database.EnsureCreatedAsync();
            seed.OutboxMessages.Add(row);
            await seed.SaveChangesAsync();
        }
        var services = new ServiceCollection();
        services.AddScoped(_ => new TodoDbContext(database.Options<TodoDbContext>()));
        services.AddScoped<DbContext>(provider => provider.GetRequiredService<TodoDbContext>());
        services.AddSingleton<IEventBus>(bus.Bus);
        await using var provider = services.BuildServiceProvider();
        using var processor = new OutboxProcessor(provider, NullLogger<OutboxProcessor>.Instance);
        var pass = typeof(OutboxProcessor).GetMethod("ProcessOutboxMessagesAsync", BindingFlags.Instance | BindingFlags.NonPublic)!;
        await (Task<int>)pass.Invoke(processor, [CancellationToken.None])!;
        await using var read = new TodoDbContext(database.Options<TodoDbContext>());
        var stored = await read.OutboxMessages.AsNoTracking().SingleAsync(item => item.Id == row.Id);
        Assert.Equal(OutboxMessageStatus.Pending, stored.Status);
        Assert.Null(stored.ProcessedOnUtc);
        Assert.Equal(1, stored.RetryCount);
        Assert.True(stored.NextRetryUtc > DateTime.UtcNow);
    }

    [RabbitRestartFact("seed")]
    public async Task RestartSeed_LeavesConfirmedPoisonInQuarantine()
    {
        await using var fixture = await BrokerFixture.Connect();
        var subscription = "audit." + Guid.NewGuid().ToString("N") + ".restart";
        await using var bus = fixture.CreateBus<FailingHandler>(new Effects());
        await Subscribe<FailureEvent, FailingHandler>(bus.Bus, subscription);
        await using var channel = await fixture.Connection.CreateChannelAsync(new CreateChannelOptions(true, true));
        var messageId = Guid.NewGuid().ToString();
        await channel.BasicPublishAsync("planora-eventbus", nameof(FailureEvent), true,
            new BasicProperties { Persistent = true, MessageId = messageId }, Encoding.UTF8.GetBytes("{restart-poison"));
        var queue = "planora." + subscription + ".v1.dlq";
        var delivery = await Take(channel, queue);
        Assert.Equal(messageId, delivery.BasicProperties.MessageId);
        await channel.BasicNackAsync(delivery.DeliveryTag, false, true);
        await File.WriteAllTextAsync(RestartProofPath(), JsonSerializer.Serialize(new { queue, messageId }));
    }

    [RabbitRestartFact("verify")]
    public async Task RestartVerify_QuarantineRetainsOriginalPersistentMessage()
    {
        using var proof = JsonDocument.Parse(await File.ReadAllTextAsync(RestartProofPath()));
        var queue = proof.RootElement.GetProperty("queue").GetString()!;
        Assert.StartsWith("planora.audit.", queue);
        Assert.EndsWith(".restart.v1.dlq", queue);
        await using var fixture = await BrokerFixture.Connect();
        await using var channel = await fixture.Connection.CreateChannelAsync();
        var delivery = await Take(channel, queue);
        Assert.Equal(proof.RootElement.GetProperty("messageId").GetString(), delivery.BasicProperties.MessageId);
        Assert.Equal("{restart-poison", Encoding.UTF8.GetString(delivery.Body.Span));
        Assert.True(delivery.BasicProperties.Persistent);
        Assert.True(delivery.BasicProperties.Headers!.ContainsKey("x-death"));
        await channel.BasicAckAsync(delivery.DeliveryTag, false);
    }

    private static string RestartProofPath() => Path.ChangeExtension(
        Environment.GetEnvironmentVariable("PLANORA_TEST_RABBIT_FIXTURE")!, "restart.json");

    private static Task Subscribe<TEvent, THandler>(RabbitMqEventBus bus, string id)
        where TEvent : IntegrationEvent where THandler : IIntegrationEventHandler<TEvent>
        => bus.SubscribeAsync<TEvent, THandler>(id);

    private static async Task Until(Func<bool> condition, string reason)
    {
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (!condition() && DateTime.UtcNow < deadline)
            await Task.Delay(50);
        Assert.True(condition(), reason);
    }

    private static async Task<BasicGetResult> Take(IChannel channel, string queue)
    {
        BasicGetResult? result = null;
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (result is null && DateTime.UtcNow < deadline)
        {
            result = await channel.BasicGetAsync(queue, false);
            if (result is null) await Task.Delay(50);
        }
        Assert.NotNull(result);
        return result!;
    }

    public sealed class DeletedEvent : IntegrationEvent { }
    public sealed class FailureEvent : IntegrationEvent { }
    public sealed class UnroutedEvent : IntegrationEvent { }

    public sealed class Effects
    {
        private readonly ConcurrentDictionary<Guid, byte> _applied = new();
        private int _deliveries;
        public int Count => _applied.Count;
        public int Deliveries => Volatile.Read(ref _deliveries);
        public void Apply(Guid id) { Interlocked.Increment(ref _deliveries); _applied.TryAdd(id, 0); }
        public void Fail() { Interlocked.Increment(ref _deliveries); throw new InvalidOperationException("synthetic handler failure"); }
    }

    public static class DomainA
    {
        public sealed class UserDeletedEventConsumer(Effects effects) : IIntegrationEventHandler<DeletedEvent>
        { public Task HandleAsync(DeletedEvent message, CancellationToken cancellationToken) { effects.Apply(message.Id); return Task.CompletedTask; } }
    }
    public static class DomainB
    {
        public sealed class UserDeletedEventConsumer(Effects effects) : IIntegrationEventHandler<DeletedEvent>
        { public Task HandleAsync(DeletedEvent message, CancellationToken cancellationToken) { effects.Apply(message.Id); return Task.CompletedTask; } }
    }
    public static class DomainC
    {
        public sealed class UserDeletedEventConsumer(Effects effects) : IIntegrationEventHandler<DeletedEvent>
        { public Task HandleAsync(DeletedEvent message, CancellationToken cancellationToken) { effects.Apply(message.Id); return Task.CompletedTask; } }
    }
    public sealed class FailingHandler(Effects effects) : IIntegrationEventHandler<FailureEvent>
    { public Task HandleAsync(FailureEvent message, CancellationToken cancellationToken) { effects.Fail(); return Task.CompletedTask; } }

    private sealed class TestBus(ServiceProvider provider, RabbitMqEventBus bus) : IAsyncDisposable
    {
        public RabbitMqEventBus Bus => bus;
        public async ValueTask DisposeAsync() { await bus.DisposeAsync(); await provider.DisposeAsync(); }
    }

    private sealed class BrokerFixture(IConnection connection) : IRabbitMqConnectionManager, IAsyncDisposable
    {
        public IConnection Connection => connection;
        public static async Task<BrokerFixture> Connect()
        {
            var path = Environment.GetEnvironmentVariable("PLANORA_TEST_RABBIT_FIXTURE")!;
            using var settings = JsonDocument.Parse(await File.ReadAllTextAsync(path));
            var root = settings.RootElement;
            Assert.Equal("127.0.0.1", root.GetProperty("HostName").GetString());
            var factory = new ConnectionFactory
            {
                HostName = "127.0.0.1", Port = root.GetProperty("Port").GetInt32(),
                UserName = root.GetProperty("UserName").GetString()!, Password = root.GetProperty("Password").GetString()!,
                AutomaticRecoveryEnabled = false, RequestedConnectionTimeout = TimeSpan.FromSeconds(5)
            };
            return new BrokerFixture(await factory.CreateConnectionAsync());
        }
        public TestBus CreateBus<THandler>(Effects effects) where THandler : class
        {
            var services = new ServiceCollection().AddSingleton(effects).AddScoped<THandler>().BuildServiceProvider();
            return new TestBus(services, new RabbitMqEventBus(this, NullLogger<RabbitMqEventBus>.Instance, services));
        }
        public Task<IConnection> GetConnectionAsync(CancellationToken cancellationToken = default) => Task.FromResult(connection);
        public Task CloseAsync() => connection.CloseAsync();
        public ValueTask DisposeAsync() => connection.DisposeAsync();
    }
}

public sealed class RabbitFactAttribute : FactAttribute
{
    public RabbitFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PLANORA_TEST_RABBIT_FIXTURE")))
            Skip = "Requires an explicitly verified disposable RabbitMQ fixture";
    }
}

public sealed class RabbitRestartFactAttribute : FactAttribute
{
    public RabbitRestartFactAttribute(string phase)
    {
        if (Environment.GetEnvironmentVariable("PLANORA_TEST_RABBIT_RESTART_PHASE") != phase ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PLANORA_TEST_RABBIT_FIXTURE")))
            Skip = "Requires explicit seed/verify orchestration around an owned broker restart";
    }
}

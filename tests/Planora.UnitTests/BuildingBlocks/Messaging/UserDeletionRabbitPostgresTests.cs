using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.Category.Domain.Repositories;
using Planora.Category.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence.Repositories;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Repositories;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence.Repositories;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;
using RabbitMQ.Client;
using CategoryEntity = Planora.Category.Domain.Entities.Category;
using CategoryConsumer = Planora.Category.Application.Features.IntegrationEvents.UserDeletedEventConsumer;
using CollaborationConsumer = Planora.Collaboration.Application.Features.IntegrationEvents.UserDeletedEventConsumer;
using TodoConsumer = Planora.Todo.Application.Features.IntegrationEvents.UserDeletedEventConsumer;

namespace Planora.UnitTests.BuildingBlocks.Messaging;

public sealed class UserDeletionRabbitPostgresTests
{
    [RabbitPostgresFact]
    public async Task OneDeletion_ReachesAllDomains_WithSharedTodoReplicas_AndReplayDoesNotRewriteRows()
    {
        await using var todoDatabase = await TemporaryDatabase.CreateAsync();
        await using var categoryDatabase = await TemporaryDatabase.CreateAsync();
        await using var collaborationDatabase = await TemporaryDatabase.CreateAsync();
        await using var broker = await Broker.Connect();
        var deletedUser = Guid.NewGuid();
        var retainedUser = Guid.NewGuid();
        var retainedViewer = Guid.NewGuid();
        var rows = await Seed(todoDatabase, categoryDatabase, collaborationDatabase,
            deletedUser, retainedUser, retainedViewer);
        var todoLog = new CompletionLog<TodoConsumer>();
        var categoryLog = new CompletionLog<CategoryConsumer>();
        var collaborationLog = new CompletionLog<CollaborationConsumer>();
        await using var todo = TodoBus(broker, todoDatabase, todoLog);
        await using var replica = TodoBus(broker, todoDatabase, todoLog);
        await using var category = CategoryBus(broker, categoryDatabase, categoryLog);
        await using var collaboration = CollaborationBus(broker, collaborationDatabase, collaborationLog);
        var prefix = "audit." + Guid.NewGuid().ToString("N");
        await todo.Bus.SubscribeAsync<UserDeletedIntegrationEvent, TodoConsumer>(prefix + ".todo");
        await replica.Bus.SubscribeAsync<UserDeletedIntegrationEvent, TodoConsumer>(prefix + ".todo");
        await category.Bus.SubscribeAsync<UserDeletedIntegrationEvent, CategoryConsumer>(prefix + ".category");
        await collaboration.Bus.SubscribeAsync<UserDeletedIntegrationEvent, CollaborationConsumer>(prefix + ".collaboration");
        await using var channel = await broker.Connection.CreateChannelAsync();
        var todoQueue = await channel.QueueDeclarePassiveAsync("planora." + prefix + ".todo.v1");
        Assert.Equal(2u, todoQueue.ConsumerCount);

        var message = new UserDeletedIntegrationEvent(deletedUser, "synthetic@example.invalid");
        await todo.Bus.PublishAsync(message);
        await Until(() => todoLog.Completed == 1 && categoryLog.Completed == 1 && collaborationLog.Completed == 1);
        var first = await AssertStoredState(todoDatabase, categoryDatabase, collaborationDatabase,
            rows, deletedUser, retainedViewer);

        // Do not register an inbox here: replay must execute the actual domain consumers,
        // rather than stop at a transport dedup record before their idempotency is exercised.
        await todo.Bus.PublishAsync(message);
        await Until(() => todoLog.Completed == 2 && categoryLog.Completed == 2 && collaborationLog.Completed == 2);
        var replay = await AssertStoredState(todoDatabase, categoryDatabase, collaborationDatabase,
            rows, deletedUser, retainedViewer);
        Assert.Equal(first, replay);
    }

    private static TestBus TodoBus(Broker broker, TemporaryDatabase database, CompletionLog<TodoConsumer> log)
    {
        var services = new ServiceCollection();
        services.AddScoped(_ => new TodoDbContext(database.Options<TodoDbContext>()));
        services.AddScoped<ITodoRepository, TodoRepository>();
        services.AddScoped<IUnitOfWork, TodoUnitOfWork>();
        services.AddSingleton<ILogger<TodoConsumer>>(log);
        services.AddScoped<TodoConsumer>();
        return new TestBus(broker, services);
    }

    private static TestBus CategoryBus(Broker broker, TemporaryDatabase database, CompletionLog<CategoryConsumer> log)
    {
        var services = new ServiceCollection();
        services.AddScoped(_ => new CategoryDbContext(database.Options<CategoryDbContext>(), new NoOpDispatcher()));
        services.AddScoped<ICategoryRepository, CategoryRepository>();
        services.AddScoped<IUnitOfWork, Planora.Category.Infrastructure.Persistence.UnitOfWork>();
        services.AddSingleton<ILogger<CategoryConsumer>>(log);
        services.AddScoped<CategoryConsumer>();
        return new TestBus(broker, services);
    }

    private static TestBus CollaborationBus(Broker broker, TemporaryDatabase database, CompletionLog<CollaborationConsumer> log)
    {
        var services = new ServiceCollection();
        services.AddScoped(_ => new CollaborationDbContext(database.Options<CollaborationDbContext>()));
        services.AddScoped<ICommentRepository, CommentRepository>();
        services.AddScoped<IUnitOfWork, CollaborationUnitOfWork>();
        services.AddSingleton<ILogger<CollaborationConsumer>>(log);
        services.AddScoped<CollaborationConsumer>();
        return new TestBus(broker, services);
    }

    private static async Task<SeedRows> Seed(TemporaryDatabase todoDatabase, TemporaryDatabase categoryDatabase,
        TemporaryDatabase collaborationDatabase, Guid deletedUser, Guid retainedUser, Guid retainedViewer)
    {
        await using var todo = new TodoDbContext(todoDatabase.Options<TodoDbContext>());
        await using var category = new CategoryDbContext(categoryDatabase.Options<CategoryDbContext>(), new NoOpDispatcher());
        await using var collaboration = new CollaborationDbContext(collaborationDatabase.Options<CollaborationDbContext>());
        await todo.Database.EnsureCreatedAsync();
        await category.Database.EnsureCreatedAsync();
        await collaboration.Database.EnsureCreatedAsync();
        var deletedTodo = TodoItem.Create(deletedUser, "synthetic deleted owner's task");
        var retainedTodo = TodoItem.Create(retainedUser, "synthetic unrelated task",
            sharedWithUserIds: [deletedUser, retainedViewer]);
        todo.TodoItems.AddRange(deletedTodo, retainedTodo);
        foreach (var viewer in new[] { deletedUser, retainedViewer })
        {
            todo.Set<TodoItemWorker>().Add(new TodoItemWorker
                { TodoItemId = retainedTodo.Id, UserId = viewer, JoinedAt = DateTime.UtcNow });
            todo.UserTodoViewPreferences.Add(new UserTodoViewPreference
                { TodoItemId = retainedTodo.Id, ViewerId = viewer, HiddenByViewer = true });
        }
        var deletedCategory = CategoryEntity.Create(deletedUser, "synthetic deleted category", null, "#123456", null, 0);
        var retainedCategory = CategoryEntity.Create(retainedUser, "synthetic retained category", null, "#654321", null, 0);
        category.Categories.AddRange(deletedCategory, retainedCategory);
        var deletedComment = Comment.Create(retainedTodo.Id, deletedUser, "Synthetic deleted author", "synthetic removed comment");
        var retainedComment = Comment.Create(retainedTodo.Id, retainedUser, "Synthetic retained author", "synthetic retained comment");
        collaboration.Comments.AddRange(deletedComment, retainedComment);
        await todo.SaveChangesAsync();
        await category.SaveChangesAsync();
        await collaboration.SaveChangesAsync();
        return new SeedRows(deletedTodo.Id, retainedTodo.Id, deletedCategory.Id, retainedCategory.Id,
            deletedComment.Id, retainedComment.Id);
    }

    private static async Task<StoredState> AssertStoredState(TemporaryDatabase todoDatabase,
        TemporaryDatabase categoryDatabase, TemporaryDatabase collaborationDatabase,
        SeedRows rows, Guid deletedUser, Guid retainedViewer)
    {
        await using var todo = new TodoDbContext(todoDatabase.Options<TodoDbContext>());
        await using var category = new CategoryDbContext(categoryDatabase.Options<CategoryDbContext>(), new NoOpDispatcher());
        await using var collaboration = new CollaborationDbContext(collaborationDatabase.Options<CollaborationDbContext>());
        var removedTodo = await Read(todo, rows.DeletedTodo, deletedUser, deleted: true);
        var removedCategory = await Read(category, rows.DeletedCategory, deletedUser, deleted: true);
        var removedComment = await Read(collaboration, rows.DeletedComment, deletedUser, deleted: true);
        var retainedTodo = await Read(todo, rows.RetainedTodo, deletedUser, deleted: false);
        var retainedCategory = await Read(category, rows.RetainedCategory, deletedUser, deleted: false);
        var retainedComment = await Read(collaboration, rows.RetainedComment, deletedUser, deleted: false);
        Assert.False(await todo.TodoItemShares.AnyAsync(row => row.SharedWithUserId == deletedUser));
        Assert.False(await todo.Set<TodoItemWorker>().AnyAsync(row => row.UserId == deletedUser));
        Assert.False(await todo.UserTodoViewPreferences.AnyAsync(row => row.ViewerId == deletedUser));
        Assert.Equal(1, await todo.TodoItemShares.CountAsync(row => row.SharedWithUserId == retainedViewer));
        Assert.Equal(1, await todo.Set<TodoItemWorker>().CountAsync(row => row.UserId == retainedViewer));
        Assert.Equal(1, await todo.UserTodoViewPreferences.CountAsync(row => row.ViewerId == retainedViewer));
        return new StoredState(removedTodo, removedCategory, removedComment, retainedTodo, retainedCategory, retainedComment);
    }

    private static Task<RowState> Read(DbContext context, Guid id, Guid deletedUser, bool deleted) => context switch
    {
        TodoDbContext todo => Read(todo.TodoItems, id, deletedUser, deleted),
        CategoryDbContext category => Read(category.Categories, id, deletedUser, deleted),
        CollaborationDbContext collaboration => Read(collaboration.Comments, id, deletedUser, deleted),
        _ => throw new ArgumentException("Unexpected test context", nameof(context))
    };

    private static async Task<RowState> Read<TEntity>(DbSet<TEntity> entities, Guid id, Guid deletedUser, bool deleted)
        where TEntity : BaseEntity
    {
        var stored = await entities.IgnoreQueryFilters().AsNoTracking().Where(row => row.Id == id)
            .Select(row => new RowState(row.IsDeleted, row.DeletedBy, row.DeletedAt, EF.Property<uint>(row, "xmin")))
            .SingleAsync();
        Assert.Equal(deleted, stored.IsDeleted);
        if (deleted)
        {
            Assert.Equal(deletedUser, stored.DeletedBy);
            Assert.NotNull(stored.DeletedAt);
        }
        else
        {
            Assert.Null(stored.DeletedBy);
            Assert.Null(stored.DeletedAt);
        }
        return stored;
    }

    private static async Task Until(Func<bool> completed)
    {
        var deadline = DateTime.UtcNow.AddSeconds(20);
        while (!completed() && DateTime.UtcNow < deadline)
            await Task.Delay(50);
        Assert.True(completed(), "Every domain consumer must complete once per published delivery");
    }

    private sealed record SeedRows(Guid DeletedTodo, Guid RetainedTodo, Guid DeletedCategory,
        Guid RetainedCategory, Guid DeletedComment, Guid RetainedComment);
    private sealed record RowState(bool IsDeleted, Guid? DeletedBy, DateTime? DeletedAt, uint Version);
    private sealed record StoredState(RowState DeletedTodo, RowState DeletedCategory, RowState DeletedComment,
        RowState RetainedTodo, RowState RetainedCategory, RowState RetainedComment);

    private sealed class CompletionLog<T> : ILogger<T>
    {
        private int _completed;
        public int Completed => Volatile.Read(ref _completed);
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state,
            Exception? exception, Func<TState, Exception?, string> formatter)
        {
            if (logLevel == LogLevel.Information)
                Interlocked.Increment(ref _completed);
        }
    }

    private sealed class NoOpDispatcher : IDomainEventDispatcher
    {
        public Task DispatchAsync(IDomainEvent domainEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task DispatchAsync(IEnumerable<IDomainEvent> domainEvents, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class TestBus : IAsyncDisposable
    {
        private readonly ServiceProvider _provider;
        public RabbitMqEventBus Bus { get; }
        public TestBus(Broker broker, ServiceCollection services)
        {
            _provider = services.BuildServiceProvider();
            Bus = new RabbitMqEventBus(broker, NullLogger<RabbitMqEventBus>.Instance, _provider);
        }
        public async ValueTask DisposeAsync()
        {
            await Bus.DisposeAsync();
            await _provider.DisposeAsync();
        }
    }

    private sealed class Broker(IConnection connection) : IRabbitMqConnectionManager, IAsyncDisposable
    {
        public IConnection Connection => connection;
        public static async Task<Broker> Connect()
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
            return new Broker(await factory.CreateConnectionAsync());
        }
        public Task<IConnection> GetConnectionAsync(CancellationToken cancellationToken = default) => Task.FromResult(connection);
        public Task CloseAsync() => connection.CloseAsync();
        public ValueTask DisposeAsync() => connection.DisposeAsync();
    }
}

public sealed class RabbitPostgresFactAttribute : FactAttribute
{
    public RabbitPostgresFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("PLANORA_TEST_RABBIT_FIXTURE")) ||
            string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(PostgresFactAttribute.Variable)))
            Skip = "Requires explicitly verified disposable RabbitMQ and PostgreSQL fixtures";
    }
}

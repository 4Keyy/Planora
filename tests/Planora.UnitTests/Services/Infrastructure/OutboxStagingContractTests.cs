using Microsoft.EntityFrameworkCore;
using Moq;
using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class OutboxStagingContractTests
{
    [Theory]
    [InlineData("canonical")]
    [InlineData("auth-adapter")]
    [InlineData("category-adapter")]
    [InlineData("todo")]
    [InlineData("collaboration")]
    public async Task StageAsync_TracksCompleteBatchUntilOwnerSaves(string implementation)
    {
        var factory = ContextFactory(implementation);
        await using var context = factory();
        await using var observer = factory();
        var repository = Repository(implementation, context);
        var first = Message();
        var second = Message();

        await StageAsync(repository, first);
        await StageAsync(repository, second);

        Assert.Equal(EntityState.Added, context.Entry(first).State);
        Assert.Equal(EntityState.Added, context.Entry(second).State);
        Assert.Empty(await observer.Set<OutboxMessage>().ToListAsync());

        await context.SaveChangesAsync();

        var persisted = await observer.Set<OutboxMessage>().Select(message => message.Id).ToListAsync();
        Assert.Equal(2, persisted.Count);
        Assert.Contains(first.Id, persisted);
        Assert.Contains(second.Id, persisted);
    }

    [Theory]
    [InlineData("canonical")]
    [InlineData("auth-adapter")]
    [InlineData("category-adapter")]
    [InlineData("todo")]
    [InlineData("collaboration")]
    public async Task StageAsync_CanceledRequestDoesNotTrackOrSave(string implementation)
    {
        var factory = ContextFactory(implementation);
        await using var context = factory();
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            StageAsync(Repository(implementation, context), Message(), cancellation.Token));

        Assert.Empty(context.ChangeTracker.Entries<OutboxMessage>());
        await using var observer = factory();
        Assert.Empty(await observer.Set<OutboxMessage>().ToListAsync());
    }

    [Theory]
    [InlineData("canonical")]
    [InlineData("auth-adapter")]
    [InlineData("category-adapter")]
    [InlineData("todo")]
    [InlineData("collaboration")]
    public async Task AddAsync_PreservesSaveThroughForExistingCallers(string implementation)
    {
        var factory = ContextFactory(implementation);
        await using var context = factory();
        var message = Message();

        await Repository(implementation, context).AddAsync(message);

        await using var observer = factory();
        Assert.Equal(message.Id, Assert.Single(await observer.Set<OutboxMessage>().ToListAsync()).Id);
    }

    private static Task StageAsync(IOutboxRepository repository, OutboxMessage message,
        CancellationToken cancellationToken = default) => repository.StageAsync(message, cancellationToken);

    private static OutboxMessage Message() => new("SyntheticEvent", "{}", DateTime.UtcNow);

    private static Func<DbContext> ContextFactory(string implementation)
    {
        var database = $"outbox-staging-{Guid.NewGuid():N}";
        return implementation switch
        {
            "auth-adapter" => () => new AuthDbContext(
                new DbContextOptionsBuilder<AuthDbContext>().UseInMemoryDatabase(database).Options,
                Mock.Of<IDomainEventDispatcher>()),
            "todo" => () => new TodoDbContext(
                new DbContextOptionsBuilder<TodoDbContext>().UseInMemoryDatabase(database).Options),
            "collaboration" => () => new CollaborationDbContext(
                new DbContextOptionsBuilder<CollaborationDbContext>().UseInMemoryDatabase(database).Options),
            _ => () => new CategoryDbContext(
                new DbContextOptionsBuilder<CategoryDbContext>().UseInMemoryDatabase(database).Options,
                Mock.Of<IDomainEventDispatcher>())
        };
    }

    private static IOutboxRepository Repository(string implementation, DbContext context) => implementation switch
    {
        "canonical" => new OutboxRepository<CategoryDbContext>((CategoryDbContext)context),
        "auth-adapter" => new Planora.Auth.Infrastructure.Persistence.Repositories.OutboxRepository((AuthDbContext)context),
        "category-adapter" => new Planora.Category.Infrastructure.Persistence.Repositories.OutboxRepository((CategoryDbContext)context),
        "todo" => new Planora.Todo.Infrastructure.Persistence.Repositories.OutboxRepository((TodoDbContext)context),
        "collaboration" => new Planora.Collaboration.Infrastructure.Persistence.Repositories.OutboxRepository((CollaborationDbContext)context),
        _ => throw new ArgumentOutOfRangeException(nameof(implementation))
    };
}

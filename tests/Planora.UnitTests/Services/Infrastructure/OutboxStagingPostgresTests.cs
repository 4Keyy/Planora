using Microsoft.EntityFrameworkCore;
using Npgsql;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class OutboxStagingPostgresTests
{
    [PostgresFact]
    public Task CanonicalRepository_OwnerSaveCommitsMutationAndCompleteBatch() => VerifyOwnerSave(canonical: true);

    [PostgresFact]
    public Task TodoRepository_OwnerSaveCommitsMutationAndCompleteBatch() => VerifyOwnerSave(canonical: false);

    [PostgresFact]
    public Task CanonicalRepository_RejectedOutboxInsertRollsBackOwnerMutation() => VerifyFailedSave(canonical: true);

    [PostgresFact]
    public Task TodoRepository_RejectedOutboxInsertRollsBackOwnerMutation() => VerifyFailedSave(canonical: false);

    private static async Task VerifyOwnerSave(bool canonical)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var owner = new TodoDbContext(database.Options<TodoDbContext>());
        await owner.Database.EnsureCreatedAsync();
        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        var todo = TodoItem.Create(Guid.NewGuid(), "synthetic staged mutation");
        owner.TodoItems.Add(todo);
        var repository = Repository(owner, canonical);
        var first = Message();
        var second = Message();

        await repository.StageAsync(first);
        await repository.StageAsync(second);

        Assert.Equal(0, await observer.TodoItems.CountAsync());
        Assert.Equal(0, await observer.OutboxMessages.CountAsync());
        await owner.SaveChangesAsync();
        Assert.Equal(todo.Id, (await observer.TodoItems.SingleAsync()).Id);
        var eventIds = await observer.OutboxMessages.Select(message => message.Id).ToListAsync();
        Assert.Equal(2, eventIds.Count);
        Assert.Contains(first.Id, eventIds);
        Assert.Contains(second.Id, eventIds);
    }

    private static async Task VerifyFailedSave(bool canonical)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var owner = new TodoDbContext(database.Options<TodoDbContext>());
        await owner.Database.EnsureCreatedAsync();
        owner.TodoItems.Add(TodoItem.Create(Guid.NewGuid(), "must roll back"));
        var repository = Repository(owner, canonical);
        await repository.StageAsync(Message());
        // PostgreSQL rejects Type beyond the mapped varchar(255), inside the owner save.
        await repository.StageAsync(new OutboxMessage(new string('x', 256), "{}", DateTime.UtcNow));

        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => owner.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.StringDataRightTruncation,
            Assert.IsType<PostgresException>(failure.InnerException).SqlState);

        await using var observer = new TodoDbContext(database.Options<TodoDbContext>());
        Assert.Equal(0, await observer.TodoItems.CountAsync());
        Assert.Equal(0, await observer.OutboxMessages.CountAsync());
    }

    private static OutboxMessage Message() => new("SyntheticEvent", "{}", DateTime.UtcNow);

    private static IOutboxRepository Repository(TodoDbContext context, bool canonical) => canonical
        ? new Planora.BuildingBlocks.Infrastructure.Persistence.OutboxRepository<TodoDbContext>(context)
        : new Planora.Todo.Infrastructure.Persistence.Repositories.OutboxRepository(context);
}

using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Category.Infrastructure.Persistence;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

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

    [PostgresFact]
    public async Task CategoryDeletion_RejectedOutboxInsertRollsBackAndRetryCommitsBoth()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        var options = database.Options<CategoryDbContext>();
        var dispatcher = Mock.Of<IDomainEventDispatcher>();
        await using var owner = new CategoryDbContext(options, dispatcher);
        await owner.Database.EnsureCreatedAsync();
        var category = CategoryEntity.Create(Guid.NewGuid(), "Category to delete", null, "#000000", null, 0);
        owner.Categories.Add(category);
        await owner.SaveChangesAsync();

        await using var observer = new CategoryDbContext(options, dispatcher);
        await observer.Database.ExecuteSqlRawAsync(
            """ALTER TABLE "OutboxMessages" ADD CONSTRAINT reject_test_outbox CHECK (false)""");

        category.Delete(category.UserId);
        var failure = await Assert.ThrowsAsync<DbUpdateException>(() => owner.SaveChangesAsync());
        Assert.Equal(PostgresErrorCodes.CheckViolation, Assert.IsType<PostgresException>(failure.InnerException).SqlState);
        Assert.False(await observer.Categories.IgnoreQueryFilters().Select(row => row.IsDeleted).SingleAsync());
        Assert.False(await observer.OutboxMessages.AnyAsync());

        await observer.Database.ExecuteSqlRawAsync("""ALTER TABLE "OutboxMessages" DROP CONSTRAINT reject_test_outbox""");
        await owner.SaveChangesAsync();

        Assert.True(await observer.Categories.IgnoreQueryFilters().Select(row => row.IsDeleted).SingleAsync());
        Assert.Equal(1, await observer.OutboxMessages.CountAsync());
    }

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

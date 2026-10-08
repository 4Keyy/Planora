using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

[Trait("TestType", "Integration")]
public sealed class TodoDatabaseStartupTests
{
    private static readonly string[] Historical =
    [
        "20260510211105_AddWorkersAndComments", "20260511105105_AddViewerCompletion",
        "20260517225900_AddSystemComment", "20260518222758_AddGenesisComment",
        "20260525143832_AddCommentAvatarUrl", "20260526201043_RemoveCommentAvatarSnapshot",
        "20260529120000_RemoveCommentsAddOutbox", "20260602111500_AddSubtaskParentTodoId"
    ];

    [PostgresFact]
    public async Task UnknownManagedHistory_StopsBeforeSchemaOrHistoryWrites()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        var todo = TodoItem.Create(Guid.NewGuid(), "preserve this row");
        db.Add(todo);
        await db.SaveChangesAsync();
        await SeedHistory(db, db.Database.GetMigrations().Append("20990101000000_UnknownTodo"));
        var before = (await db.Database.GetAppliedMigrationsAsync()).ToArray();
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => Prepare(db));
        Assert.Contains("20990101000000_UnknownTodo", error.Message);
        Assert.Equal(before, await db.Database.GetAppliedMigrationsAsync());
        Assert.Equal("preserve this row", (await db.TodoItems.SingleAsync()).Title);
    }

    [PostgresFact]
    public async Task CleanDatabase_AppliesTheFullChainAndCurrentModel_AndRestarts()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new TodoDbContext(database.Options<TodoDbContext>());
        await Prepare(db);
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
        var todo = TodoItem.Create(Guid.NewGuid(), new string('x', 1500));
        db.Add(todo);
        await db.SaveChangesAsync();
        await Prepare(db);
        Assert.Equal(1500, (await db.TodoItems.SingleAsync()).Title.Length);
    }

    [PostgresFact]
    public async Task ModelCreatedSchema_AdoptsOnlyReviewedHistoricalEquivalenceAndPreservesRows()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        var todo = TodoItem.Create(Guid.NewGuid(), "old public audience", isPublic: true, sharedWithUserIds: [Guid.NewGuid()]);
        db.Add(todo);
        await db.SaveChangesAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE todo.\"TodoItems\" DROP COLUMN IF EXISTS \"AllFriendsSnapshotAt\"");
        db.ChangeTracker.Clear();
        await Prepare(db);
        Assert.Equal(db.Database.GetMigrations(), await db.Database.GetAppliedMigrationsAsync());
        Assert.Equal(Historical, (await db.Database.GetAppliedMigrationsAsync()).Take(Historical.Length));
        Assert.Equal("old public audience", (await db.TodoItems.Include(t=>t.SharedWith).SingleAsync()).Title);
        Assert.Single((await db.TodoItems.Include(t=>t.SharedWith).SingleAsync()).SharedWith);
        await Prepare(db);
    }

    [PostgresFact]
    public async Task PartialUnmanagedSchema_RejectsBeforeCreatingHistoryOrOtherTables()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.ExecuteSqlRawAsync("CREATE SCHEMA todo; CREATE TABLE todo.\"TodoItems\" (\"Id\" uuid PRIMARY KEY)");
        await Assert.ThrowsAsync<InvalidOperationException>(() => Prepare(db));
        Assert.Empty(await db.Database.GetAppliedMigrationsAsync());
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task IncompatibleColumn_RejectsWithoutAdoptingHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE todo.\"TodoItems\" ALTER COLUMN \"UserId\" TYPE text USING \"UserId\"::text");
        await Assert.ThrowsAsync<InvalidOperationException>(() => Prepare(db));
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task MissingForeignKey_RejectsWithoutAdoptingHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE todo.todo_item_shares DROP CONSTRAINT \"FK_todo_item_shares_TodoItems_TodoItemId\"");
        await Assert.ThrowsAsync<InvalidOperationException>(() => Prepare(db));
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task NonemptyLegacyComments_StopsBeforeDestructivePendingMigration()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var db = new TodoDbContext(database.Options<TodoDbContext>());
        var migrator = db.GetService<IMigrator>();
        await migrator.MigrateAsync("20260526201043_RemoveCommentAvatarSnapshot");
        var id=Guid.NewGuid();var owner=Guid.NewGuid();
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO todo.\"TodoItems\" (\"Id\",\"Title\",\"UserId\",\"CreatedAt\") VALUES ({id},'legacy',{owner},now())");
        await db.Database.ExecuteSqlInterpolatedAsync($"INSERT INTO todo.todo_item_comments (\"Id\",\"TodoItemId\",\"AuthorId\",\"AuthorName\",\"Content\",\"CreatedAt\") VALUES ({Guid.NewGuid()},{id},{owner},'Test','keep my comment',now())");
        var before=(await db.Database.GetAppliedMigrationsAsync()).ToArray();
        var error=await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(db));
        Assert.Contains("Collaboration", error.Message);
        Assert.Equal(before,await db.Database.GetAppliedMigrationsAsync());
        Assert.True(await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM todo.todo_item_comments WHERE \"Content\"='keep my comment') AS \"Value\"").SingleAsync());
    }

    [PostgresFact]
    public async Task GappedManagedHistory_RejectsWithoutRepairingIds()
    {
        await using var database=await TemporaryDatabase.CreateAsync();
        await using var db=new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        await SeedHistory(db,[Historical[0],Historical[2]]);
        var before=(await db.Database.GetAppliedMigrationsAsync()).ToArray();
        await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(db));
        Assert.Equal(before,await db.Database.GetAppliedMigrationsAsync());
    }

    [PostgresFact]
    public async Task MissingHistoricalIndex_RejectsBeforeAdoptingHistory()
    {
        await using var database=await TemporaryDatabase.CreateAsync();
        await using var db=new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("DROP INDEX todo.\"IX_TodoItems_UserId\"");
        await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(db));
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task ConflictingAdditiveIndexName_RejectsBeforeAdoptingHistory()
    {
        await using var database=await TemporaryDatabase.CreateAsync();
        await using var db=new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("DROP INDEX todo.ix_todo_items_all_friends_snapshot_roots; CREATE INDEX ix_todo_items_all_friends_snapshot_roots ON todo.\"TodoItems\" ((lower(\"Title\")))");
        await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(db));
        Assert.False(await HistoryExists(db));
    }

    [PostgresFact]
    public async Task UnmanagedComments_RejectsBeforeFalselyStampingTheirRemoval()
    {
        await using var database=await TemporaryDatabase.CreateAsync();
        await using var db=new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("CREATE TABLE todo.todo_item_comments (content text); INSERT INTO todo.todo_item_comments VALUES ('keep legacy text')");
        var error=await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(db));
        Assert.Contains("Collaboration",error.Message);
        Assert.False(await HistoryExists(db));
        Assert.True(await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM todo.todo_item_comments WHERE content='keep legacy text') AS \"Value\"").SingleAsync());
    }

    [PostgresFact]
    public async Task CompatibleCurrentUnmanagedSchema_PreservesAFrozenAudience()
    {
        await using var database=await TemporaryDatabase.CreateAsync();
        await using var db=new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        var friend=Guid.NewGuid(); var stamp=new DateTime(2026,10,7,12,0,0,DateTimeKind.Utc);
        var todo=TodoItem.Create(Guid.NewGuid(),"keep snapshot",isPublic:true,sharedWithUserIds:[friend],allFriendsSnapshotAt:stamp);
        db.Add(todo);await db.SaveChangesAsync(); db.ChangeTracker.Clear();
        await Prepare(db);
        var stored=await db.TodoItems.Include(t=>t.SharedWith).SingleAsync();
        Assert.Equal(stamp,stored.AllFriendsSnapshotAt);Assert.Equal(friend,Assert.Single(stored.SharedWith).SharedWithUserId);
        await Prepare(db);
        Assert.Equal(db.Database.GetMigrations(),await db.Database.GetAppliedMigrationsAsync());
    }
    [PostgresFact]
    public async Task ConcurrentModelCreatedStartup_AdoptsHistoryOnceAndPreservesRows()
    {
        await using var database=await TemporaryDatabase.CreateAsync();
        await using(var seed=new TodoDbContext(database.Options<TodoDbContext>()))
        {
            await seed.Database.EnsureCreatedAsync();
            seed.Add(TodoItem.Create(Guid.NewGuid(),"concurrent bootstrap"));await seed.SaveChangesAsync();
            await seed.Database.ExecuteSqlRawAsync("ALTER TABLE todo.\"TodoItems\" DROP COLUMN \"AllFriendsSnapshotAt\"");
        }
        await using var first=new TodoDbContext(database.Options<TodoDbContext>());
        await using var second=new TodoDbContext(database.Options<TodoDbContext>());
        await Task.WhenAll(Prepare(first),Prepare(second));
        Assert.Equal(first.Database.GetMigrations(),await first.Database.GetAppliedMigrationsAsync());
        Assert.Equal("concurrent bootstrap",(await first.TodoItems.SingleAsync()).Title);
    }
    [PostgresFact]
    public async Task UnsafePublicDefault_RejectsBeforeAdoptingHistory()
    {
        await using var database=await TemporaryDatabase.CreateAsync();
        await using var db=new TodoDbContext(database.Options<TodoDbContext>());
        await db.Database.EnsureCreatedAsync();
        await db.Database.ExecuteSqlRawAsync("ALTER TABLE todo.\"TodoItems\" ALTER COLUMN \"IsPublic\" SET DEFAULT TRUE");
        await Assert.ThrowsAsync<InvalidOperationException>(()=>Prepare(db));
        Assert.False(await HistoryExists(db));
    }
    private static Task Prepare(TodoDbContext db) => TodoDatabaseStartup.EnsureReadyAsync(db, NullLogger.Instance, CancellationToken.None);
    private static Task<bool> HistoryExists(TodoDbContext db) => db.Database.SqlQueryRaw<bool>("SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL AS \"Value\"").SingleAsync();
    private static async Task SeedHistory(TodoDbContext db,IEnumerable<string> ids)
    {
        var history=db.GetService<IHistoryRepository>();
        await db.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript());
        foreach(var id in ids)await db.Database.ExecuteSqlRawAsync(history.GetInsertScript(new HistoryRow(id,"10.0.8")));
    }
}

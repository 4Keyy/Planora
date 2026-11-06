using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Enums;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;
using Planora.UnitTests.Services.Infrastructure;

namespace Planora.UnitTests.Services.CollaborationApi.Infrastructure;

public sealed class SubtaskActivityIdentityMigrationPostgresTests
{
    [VersionedPostgresTheory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task PreSourceSchema_UpgradesWithoutRewritingLegacyCommentsOrGuessingIdentity(bool managed)
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var current = new CollaborationDbContext(database.Options<CollaborationDbContext>());
        await using var legacy = PreSubtaskActivityIdentityFactory.Create(database.Options<CollaborationDbContext>());
        if (managed)
            await current.GetService<IMigrator>().MigrateAsync(CollaborationDatabaseStartup.ReplyReferencesMigrationId);
        else
            Assert.True(await legacy.Database.EnsureCreatedAsync());

        var parent = Guid.NewGuid();
        var actor = Guid.NewGuid();
        Comment[] comments =
        [
            Comment.CreateSystem(parent, "Synthetic Actor completed a subtask: Same title"),
            Comment.Create(parent, actor, "Synthetic Actor", "Regular comment"),
            Comment.CreateReply(parent, actor, "Synthetic Actor", "Reply", ReplyTargetType.Subtask,
                Guid.NewGuid(), actor, "Snapshot author", "Snapshot preview")
        ];
        legacy.Comments.AddRange(comments);
        await legacy.SaveChangesAsync();
        var before = await FingerprintsAsync(legacy);

        await CollaborationDatabaseStartup.EnsureReadyAsync(current, NullLogger.Instance);

        Assert.Equal(current.Database.GetMigrations(), await current.Database.GetAppliedMigrationsAsync());
        Assert.Equal(before, await FingerprintsAsync(current));
        var rows = await current.Comments.AsNoTracking().OrderBy(comment => comment.Id).ToListAsync();
        Assert.Equal(comments.Length, rows.Count);
        Assert.All(rows, row => Assert.Null(row.SourceSubtaskId));
        var reply = Assert.Single(rows, row => row.ReplyToId.HasValue);
        Assert.Equal(comments[2].ReplyToPreview, reply.ReplyToPreview);
        Assert.False(reply.ReplyToDeleted);
        await CollaborationDatabaseStartup.EnsureReadyAsync(current, NullLogger.Instance);
        Assert.Equal(before, await FingerprintsAsync(current));
    }

    [PostgresFact]
    public async Task PartialSourceSchema_IsRejectedWithoutStampingUnmanagedHistory()
    {
        await using var database = await TemporaryDatabase.CreateAsync();
        await using var legacy = PreSubtaskActivityIdentityFactory.Create(database.Options<CollaborationDbContext>());
        await legacy.Database.EnsureCreatedAsync();
        await legacy.Database.ExecuteSqlRawAsync("ALTER TABLE collaboration.comments ADD COLUMN \"SourceSubtaskId\" uuid");
        await using var current = new CollaborationDbContext(database.Options<CollaborationDbContext>());

        await Assert.ThrowsAsync<DatabaseSchemaCompatibilityException>(() =>
            CollaborationDatabaseStartup.EnsureReadyAsync(current, NullLogger.Instance));

        Assert.Empty(await current.Database.GetAppliedMigrationsAsync());
        Assert.True(await current.Database.SqlQueryRaw<bool>("""
            SELECT EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='collaboration' AND table_name='comments' AND column_name='SourceSubtaskId') AS "Value"
            """).SingleAsync());
    }

    private static async Task<string[]> FingerprintsAsync(DbContext context) =>
        await context.Database.SqlQueryRaw<string>("""
            SELECT ("Id"::text || ':' || xmin::text) AS "Value" FROM collaboration.comments ORDER BY "Id"
            """).ToArrayAsync();
}

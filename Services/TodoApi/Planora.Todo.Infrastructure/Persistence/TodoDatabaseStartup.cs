using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Logging;

namespace Planora.Todo.Infrastructure.Persistence;

/// <summary>Validates migration provenance before preparing a Todo database.</summary>
public static class TodoDatabaseStartup
{
    private const string HistoricalBaseline = "20260602111500_AddSubtaskParentTodoId";
    private const string CommentRemoval = "20260529120000_RemoveCommentsAddOutbox";
    private static readonly string[] Historical =
    [
        "20260510211105_AddWorkersAndComments", "20260511105105_AddViewerCompletion",
        "20260517225900_AddSystemComment", "20260518222758_AddGenesisComment",
        "20260525143832_AddCommentAvatarUrl", "20260526201043_RemoveCommentAvatarSnapshot",
        CommentRemoval, HistoricalBaseline
    ];

    public static async Task EnsureReadyAsync(TodoDbContext db, ILogger logger, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var known = db.Database.GetMigrations().ToArray();
        if (known.Length <= Historical.Length || !known.Take(Historical.Length).SequenceEqual(Historical))
            throw Incompatible("the reviewed historical migration chain is missing from this build");
        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToArray();
        VerifyHistory(known, applied);
        var assembly = db.GetService<IMigrationsAssembly>();
        var currentModel = db.GetService<IDesignTimeModel>().Model;

        if (applied.Length == 0 && await HasTodoTablesAsync(db, cancellationToken))
        {
            // The old migration-less bootstrap created the current model without recording history.
            // Adopt only the reviewed June baseline, after proving schema equivalence. The additive
            // migration still runs normally; its ID is never fabricated or pre-stamped.
            if (await LegacyCommentsTableExistsAsync(db, cancellationToken))
                throw Incompatible("legacy task comments require an explicit Collaboration migration before baseline adoption");
            var baseline = assembly.CreateMigration(assembly.Migrations[HistoricalBaseline], db.Database.ProviderName!).TargetModel;
            baseline = db.GetService<IModelRuntimeInitializer>().Initialize(baseline, designTime: true);
            await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
            {
                await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
                await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(742810631)", cancellationToken);
                var historyExists = await db.Database.SqlQueryRaw<bool>("SELECT to_regclass('public.\"__EFMigrationsHistory\"') IS NOT NULL AS \"Value\"").SingleAsync(cancellationToken);
                var rechecked = historyExists ? (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToArray() : [];
                VerifyHistory(known, rechecked);
                if (rechecked.Length == 0)
                {
                    await TodoSchemaCompatibility.VerifyAsync(db, baseline, currentModel, allowWiderTitle: true, cancellationToken);
                    var history = db.GetService<IHistoryRepository>();
                    await db.Database.ExecuteSqlRawAsync(history.GetCreateIfNotExistsScript(), cancellationToken);
                    foreach (var id in Historical)
                        await db.Database.ExecuteSqlRawAsync(history.GetInsertScript(new HistoryRow(id, "10.0.8")), cancellationToken);
                }
                await transaction.CommitAsync(cancellationToken);
            });
            logger.LogWarning("Adopted the reviewed historical Todo baseline after validating the existing schema; preserved all rows.");
            applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToArray();
        }

        if (applied.Length > 0)
        {
            VerifyHistory(known, applied);
            var lastModel = assembly.CreateMigration(assembly.Migrations[applied[^1]], db.Database.ProviderName!).TargetModel;
            lastModel = db.GetService<IModelRuntimeInitializer>().Initialize(lastModel, designTime: true);
            await TodoSchemaCompatibility.VerifyAsync(db, lastModel, currentModel, allowWiderTitle: true, cancellationToken);
        }

        if (!applied.Contains(CommentRemoval, StringComparer.Ordinal) && await HasLegacyCommentsAsync(db, cancellationToken))
            throw Incompatible("legacy task comments must be backed up and migrated to Collaboration before their removal migration");

        await db.Database.MigrateAsync(cancellationToken);
        await TodoSchemaCompatibility.VerifyAsync(db, currentModel, currentModel, allowWiderTitle: false, cancellationToken);
        logger.LogInformation("Todo database is ready with {Count} reviewed migrations", known.Length);
    }

    private static void VerifyHistory(string[] known, string[] applied)
    {
        var unknown = applied.Except(known, StringComparer.Ordinal).ToArray();
        if (unknown.Length > 0) throw Incompatible("unknown migration history: " + string.Join(", ", unknown));
        if (!applied.SequenceEqual(known.Take(applied.Length)))
            throw Incompatible("migration history is not a chronological prefix of the reviewed chain");
    }

    private static Task<bool> HasTodoTablesAsync(TodoDbContext db, CancellationToken cancellationToken) =>
        db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname='todo') AS \"Value\"").SingleAsync(cancellationToken);

    private static async Task<bool> HasLegacyCommentsAsync(TodoDbContext db, CancellationToken cancellationToken)
    {
        var exists = await LegacyCommentsTableExistsAsync(db, cancellationToken);
        return exists && await db.Database.SqlQueryRaw<bool>("SELECT EXISTS (SELECT 1 FROM todo.todo_item_comments) AS \"Value\"").SingleAsync(cancellationToken);
    }

    private static Task<bool> LegacyCommentsTableExistsAsync(TodoDbContext db, CancellationToken cancellationToken) =>
        db.Database.SqlQueryRaw<bool>("SELECT to_regclass('todo.todo_item_comments') IS NOT NULL AS \"Value\"").SingleAsync(cancellationToken);

    internal static InvalidOperationException Incompatible(string detail) =>
        new("Todo database is incompatible: " + detail + ". Startup stopped. Restore a compatible backup or apply an explicit migration plan; existing rows and migration IDs are not repaired automatically.");
}

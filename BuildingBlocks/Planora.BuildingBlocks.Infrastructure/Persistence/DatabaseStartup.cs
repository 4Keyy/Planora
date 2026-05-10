namespace Planora.BuildingBlocks.Infrastructure.Persistence;

public static class DatabaseStartup
{
    public static async Task EnsureReadyAsync<TDbContext>(
        TDbContext db,
        ILogger logger,
        CancellationToken cancellationToken)
        where TDbContext : DbContext
    {
        var dbContextName = typeof(TDbContext).Name;
        var knownMigrations = db.Database.GetMigrations().ToList();

        if (knownMigrations.Count == 0)
        {
            logger.LogWarning(
                "No EF Core migrations were found for {DbContext}. Creating the database schema from the current EF model. " +
                "This path is intended for clean local/Docker installs when migrations are user-owned and not committed.",
                dbContextName);

            var created = await db.Database.EnsureCreatedAsync(cancellationToken);
            logger.LogInformation(
                created
                    ? "Database schema for {DbContext} was created from the EF model"
                    : "Database schema for {DbContext} already exists",
                dbContextName);
            return;
        }

        var pendingMigrations = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).ToList();

        if (pendingMigrations.Count == 0)
        {
            logger.LogInformation("No pending migrations for {DbContext}; database is up to date", dbContextName);
        }
        else
        {
            logger.LogInformation(
                "Applying {Count} pending migration(s) for {DbContext}: {Migrations}",
                pendingMigrations.Count,
                dbContextName,
                string.Join(", ", pendingMigrations));

            await db.Database.MigrateAsync(cancellationToken);
            logger.LogInformation("All migrations for {DbContext} applied successfully", dbContextName);
        }

        var applied = (await db.Database.GetAppliedMigrationsAsync(cancellationToken)).ToList();
        logger.LogInformation(
            "Total applied migrations for {DbContext}: {Count}",
            dbContextName,
            applied.Count);
    }
}

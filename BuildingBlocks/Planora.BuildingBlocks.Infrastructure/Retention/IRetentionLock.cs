namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// Single-instance guard for a retention pass. Abstracted behind an interface so the guard logic in
    /// <see cref="RetentionExecutor"/> is unit-testable without a real PostgreSQL connection (the advisory
    /// lock is Postgres-only). Production uses <see cref="PostgresRetentionLock"/>; tests inject a fake.
    /// </summary>
    public interface IRetentionLock
    {
        Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken cancellationToken);
        Task ReleaseAsync(DbContext db, long key);
    }

    /// <summary>Production lock backed by a PostgreSQL session-level advisory lock.</summary>
    public sealed class PostgresRetentionLock : IRetentionLock
    {
        public Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken cancellationToken) =>
            PostgresAdvisoryLock.TryAcquireAsync(db, key, cancellationToken);

        public Task ReleaseAsync(DbContext db, long key) =>
            PostgresAdvisoryLock.ReleaseAsync(db, key);
    }
}

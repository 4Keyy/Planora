using System.Data;

namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// Thin wrapper over PostgreSQL session-level advisory locks (<c>pg_try_advisory_lock</c> /
    /// <c>pg_advisory_unlock</c>). The retention job has no leader election of its own, so this is the
    /// single-instance guard: only the replica that wins the lock runs a given policy's pass; the others
    /// skip it. This is the mechanism the reserved <c>deploy/fly/outbox-worker.fly.toml</c> already plans
    /// to use for the extracted worker.
    /// </summary>
    /// <remarks>
    /// A session-level lock is held until it is explicitly unlocked or the owning connection closes. EF
    /// normally opens/closes a connection around every command, which would drop the lock immediately, so
    /// <see cref="TryAcquireAsync"/> pins the connection open via <c>OpenConnectionAsync</c>; every command
    /// the policy then issues on the same <c>DbContext</c> reuses that one connection, keeping the lock
    /// alive. <see cref="ReleaseAsync"/> unlocks and lets the connection return to the pool.
    /// </remarks>
    public static class PostgresAdvisoryLock
    {
        public static async Task<bool> TryAcquireAsync(DbContext db, long key, CancellationToken ct)
        {
            // Pin the connection open for the whole policy pass so the session lock survives across the
            // individual DELETE statements that follow.
            await db.Database.OpenConnectionAsync(ct);

            var connection = db.Database.GetDbConnection();
            await using var cmd = connection.CreateCommand();
            cmd.CommandText = "SELECT pg_try_advisory_lock(@key)";
            AddKeyParameter(cmd, key);

            var acquired = await cmd.ExecuteScalarAsync(ct) is bool b && b;
            if (!acquired)
            {
                // Nothing to unlock — hand the connection back so we don't leak it.
                await db.Database.CloseConnectionAsync();
            }

            return acquired;
        }

        public static async Task ReleaseAsync(DbContext db, long key)
        {
            try
            {
                var connection = db.Database.GetDbConnection();
                await using var cmd = connection.CreateCommand();
                cmd.CommandText = "SELECT pg_advisory_unlock(@key)";
                AddKeyParameter(cmd, key);

                // Release must run even if the pass was cancelled, hence CancellationToken.None.
                await cmd.ExecuteScalarAsync(CancellationToken.None);
            }
            finally
            {
                await db.Database.CloseConnectionAsync();
            }
        }

        private static void AddKeyParameter(IDbCommand cmd, long key)
        {
            var p = cmd.CreateParameter();
            p.ParameterName = "@key";
            p.DbType = DbType.Int64;
            p.Value = key;
            cmd.Parameters.Add(p);
        }

        /// <summary>
        /// Deterministic 64-bit key from a policy name via FNV-1a. Must be stable <b>across processes</b>
        /// (string.GetHashCode is randomized per run, so different replicas would compute different keys
        /// and never actually mutex each other — that is exactly the bug this avoids).
        /// </summary>
        public static long KeyFor(string policyName)
        {
            const ulong offset = 14695981039346656037UL;
            const ulong prime = 1099511628211UL;

            var hash = offset;
            foreach (var ch in policyName)
            {
                hash ^= ch;
                hash *= prime;
            }

            return unchecked((long)hash);
        }
    }
}

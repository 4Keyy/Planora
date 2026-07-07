using System.Linq.Expressions;
using Planora.BuildingBlocks.Infrastructure.Observability;

namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// Shared execution harness for every retention policy. Centralises the four cross-cutting concerns so
    /// no individual policy can forget one: the single-instance advisory lock, the tripwire, dry-run, and
    /// batched deletion — plus the metrics/log emission. A policy supplies only two delegates: how to
    /// <c>count</c> eligible rows and how to <c>delete one batch</c>.
    /// </summary>
    public static class RetentionExecutor
    {
        /// <summary>
        /// Runs one guarded pass. <paramref name="countAsync"/> returns how many rows are eligible;
        /// <paramref name="deleteBatchAsync"/> deletes up to <c>batchSize</c> rows and returns how many it
        /// actually removed (0 ⇒ drained). The loop repeats until a batch removes nothing.
        /// </summary>
        public static async Task<RetentionResult> RunAsync(
            string policyName,
            DbContext db,
            RetentionContext context,
            Func<CancellationToken, Task<int>> countAsync,
            Func<int, CancellationToken, Task<int>> deleteBatchAsync,
            ILogger logger,
            CancellationToken cancellationToken)
        {
            var options = context.Options;
            var lockKey = PostgresAdvisoryLock.KeyFor(policyName);

            if (!await PostgresAdvisoryLock.TryAcquireAsync(db, lockKey, cancellationToken))
            {
                logger.LogInformation(
                    "Retention[{Policy}] skipped — advisory lock held by another instance", policyName);
                return RetentionResult.SkippedResult(policyName, "lock_unavailable");
            }

            try
            {
                var eligible = await countAsync(cancellationToken);
                if (eligible == 0)
                {
                    logger.LogDebug("Retention[{Policy}] nothing to purge", policyName);
                    return new RetentionResult { PolicyName = policyName, Scanned = 0, Deleted = 0, DryRun = options.DryRun };
                }

                if (eligible > options.MaxDeletionsPerRun)
                {
                    logger.LogError(
                        "Retention[{Policy}] TRIPWIRE tripped: {Eligible} eligible rows exceed MaxDeletionsPerRun {Max} — aborting pass without deleting",
                        policyName, eligible, options.MaxDeletionsPerRun);
                    PlanoraMetrics.RetentionTripwire.Add(1, new KeyValuePair<string, object?>("policy", policyName));
                    return new RetentionResult
                    {
                        PolicyName = policyName,
                        Scanned = eligible,
                        Deleted = 0,
                        TrippedGuard = true,
                        DryRun = options.DryRun
                    };
                }

                if (options.DryRun)
                {
                    logger.LogInformation(
                        "Retention[{Policy}] DRY-RUN: would delete {Eligible} row(s)", policyName, eligible);
                    return new RetentionResult { PolicyName = policyName, Scanned = eligible, Deleted = 0, DryRun = true };
                }

                var total = 0;
                int deleted;
                do
                {
                    deleted = await deleteBatchAsync(options.BatchSize, cancellationToken);
                    total += deleted;
                }
                while (deleted > 0 && !cancellationToken.IsCancellationRequested);

                logger.LogInformation(
                    "Retention[{Policy}] purged {Total} row(s) (found {Eligible})", policyName, total, eligible);
                PlanoraMetrics.RetentionRowsDeleted.Add(total, new KeyValuePair<string, object?>("policy", policyName));

                return new RetentionResult { PolicyName = policyName, Scanned = eligible, Deleted = total };
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Retention[{Policy}] failed mid-pass", policyName);
                PlanoraMetrics.RetentionErrors.Add(1, new KeyValuePair<string, object?>("policy", policyName));
                throw;
            }
            finally
            {
                await PostgresAdvisoryLock.ReleaseAsync(db, lockKey);
            }
        }

        /// <summary>
        /// Deletes up to <paramref name="batchSize"/> rows of <typeparamref name="TEntity"/> matching
        /// <paramref name="predicate"/> in a single set-based <c>DELETE … WHERE id IN (SELECT id … LIMIT n)</c>
        /// — no entities are loaded or tracked. The soft-delete filter is bypassed via
        /// <c>IgnoreQueryFilters()</c> because purge targets are, by definition, already soft-deleted.
        /// </summary>
        public static async Task<int> DeleteBatchByIdAsync<TEntity>(
            DbContext db,
            Expression<Func<TEntity, bool>> predicate,
            int batchSize,
            CancellationToken cancellationToken)
            where TEntity : class
        {
            var idBatch = db.Set<TEntity>()
                .IgnoreQueryFilters()
                .Where(predicate)
                .Select(e => EF.Property<Guid>(e, "Id"))
                .Take(batchSize);

            return await db.Set<TEntity>()
                .IgnoreQueryFilters()
                .Where(e => idBatch.Contains(EF.Property<Guid>(e, "Id")))
                .ExecuteDeleteAsync(cancellationToken);
        }

        /// <summary>Counts rows matching <paramref name="predicate"/>, bypassing soft-delete query filters.</summary>
        public static Task<int> CountAsync<TEntity>(
            DbContext db,
            Expression<Func<TEntity, bool>> predicate,
            CancellationToken cancellationToken)
            where TEntity : class =>
            db.Set<TEntity>().IgnoreQueryFilters().CountAsync(predicate, cancellationToken);
    }
}

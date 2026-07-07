using Planora.BuildingBlocks.Domain;

namespace Planora.BuildingBlocks.Infrastructure.Retention.Policies
{
    /// <summary>
    /// Physically deletes rows of <typeparamref name="TEntity"/> that have been soft-deleted longer than
    /// <see cref="RetentionOptions.SoftDeleteGraceDays"/>. The grace window is the recovery window: within
    /// it a soft-deleted row can still be restored; past it the row is gone for good. Cross-service cascade
    /// has already happened at soft-delete time (integration events fire then), so this purge publishes no
    /// events — it only reclaims storage.
    /// </summary>
    /// <remarks>
    /// Registered once per entity type per service (e.g. <c>SoftDeletedPurgePolicy&lt;Category&gt;</c>). Use a
    /// bespoke policy instead for entities that own rows in another table without a database-level cascade
    /// (TodoApi's <c>UserTodoViewPreference</c> is the notable case — see <c>TodoSoftDeletePurgePolicy</c>).
    /// </remarks>
    public sealed class SoftDeletedPurgePolicy<TEntity> : IRetentionPolicy
        where TEntity : BaseEntity
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<SoftDeletedPurgePolicy<TEntity>> _logger;

        public SoftDeletedPurgePolicy(IRetentionLock retentionLock, ILogger<SoftDeletedPurgePolicy<TEntity>> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => $"soft-delete-purge:{typeof(TEntity).Name}";

        public bool IsEnabled(RetentionOptions options) => options.PurgeSoftDeleted;

        public async Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();

            if (db.Model.FindEntityType(typeof(TEntity)) is null)
                return RetentionResult.SkippedResult(Name, "entity_not_mapped");

            var cutoff = context.UtcNow.AddDays(-context.Options.SoftDeleteGraceDays);

            return await RetentionExecutor.RunAsync(
                Name,
                db,
                _lock,
                context,
                ct => RetentionExecutor.CountAsync<TEntity>(
                    db, e => e.IsDeleted && e.DeletedAt < cutoff, ct),
                (batch, ct) => RetentionExecutor.DeleteBatchByIdAsync<TEntity>(
                    db, e => e.IsDeleted && e.DeletedAt < cutoff, batch, ct),
                _logger,
                cancellationToken);
        }
    }
}

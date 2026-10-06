namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// A single retention rule — "purge processed outbox rows older than N days", "hard-delete
    /// soft-deleted todos past the grace window", etc. Implementations are registered as singletons
    /// (they are stateless) and resolve their scoped dependencies (a <c>DbContext</c>, repositories)
    /// from the <see cref="IServiceProvider"/> handed to <see cref="ExecuteAsync"/>, mirroring how
    /// <c>OutboxProcessor</c> opens a fresh scope per pass.
    /// </summary>
    public interface IRetentionPolicy
    {
        /// <summary>Stable, human-readable name. Used in logs, metrics tags and the advisory-lock key.</summary>
        string Name { get; }

        /// <summary>Per-vector enable check against the bound options (each vector has its own flag).</summary>
        bool IsEnabled(RetentionOptions options);

        /// <summary>
        /// Runs one pass. <paramref name="scopedServices"/> is a fresh DI scope owned by the caller.
        /// The implementation must honour <see cref="RetentionContext.Options"/> (dry-run, batch size,
        /// tripwire) — the shared <c>RetentionExecutor</c> helper enforces all three.
        /// </summary>
        Task<RetentionResult> ExecuteAsync(
            IServiceProvider scopedServices,
            RetentionContext context,
            CancellationToken cancellationToken);
    }

    /// <summary>Immutable per-pass context: the bound options plus the single UTC clock reading for the pass.</summary>
    public sealed record RetentionContext(RetentionOptions Options, DateTime UtcNow);

    /// <summary>Outcome of one policy pass — surfaced in logs and (aggregated) metrics.</summary>
    public sealed class RetentionResult
    {
        public required string PolicyName { get; init; }

        /// <summary>Rows found eligible for deletion.</summary>
        public int Scanned { get; init; }

        /// <summary>Rows actually physically deleted (0 in dry-run / when tripped / when skipped).</summary>
        public int Deleted { get; init; }

        /// <summary>True when the pass only counted and logged (no deletes performed).</summary>
        public bool DryRun { get; init; }

        /// <summary>True when the tripwire aborted the pass because too many rows were eligible.</summary>
        public bool TrippedGuard { get; init; }

        /// <summary>True when the pass did not run (e.g. advisory lock held by another instance).</summary>
        public bool Skipped { get; init; }

        public string? SkipReason { get; init; }

        public static RetentionResult SkippedResult(string policy, string reason) =>
            new() { PolicyName = policy, Skipped = true, SkipReason = reason };
    }
}

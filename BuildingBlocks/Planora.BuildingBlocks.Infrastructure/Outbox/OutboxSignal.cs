namespace Planora.BuildingBlocks.Infrastructure.Outbox
{
    /// <summary>
    /// In-process wake signal between the producers that write to the outbox and the
    /// <see cref="OutboxProcessor"/> that dispatches it. When a command handler commits a new
    /// outbox message, <see cref="Notify"/> releases the processor from its idle wait so the
    /// message is published in milliseconds instead of waiting out the poll interval.
    ///
    /// The periodic poll remains as a safety net (a process that produced a row then crashed
    /// before signalling, or a row written by a different process/instance, is still picked up),
    /// so this is a pure latency optimisation with no correctness dependency — losing a signal
    /// only falls back to the existing poll cadence.
    ///
    /// Registered as a singleton; the producer (a SaveChanges interceptor) and the single
    /// hosted processor live in the same process, so a lightweight semaphore is all that is
    /// needed. Coalescing is intentional: many writes between two processor passes collapse into
    /// at most one pending release, because one pass drains every pending row via its batch query.
    /// </summary>
    public sealed class OutboxSignal
    {
        // Capacity 1: at most one pending wake is buffered. Extra notifies while one is already
        // pending are dropped (the next pass will see all rows anyway), preventing unbounded growth.
        private readonly SemaphoreSlim _semaphore = new(0, 1);

        /// <summary>Wake the processor now (or arm the next wait if it is mid-pass).</summary>
        public void Notify()
        {
            try { _semaphore.Release(); }
            catch (SemaphoreFullException) { /* a wake is already pending — coalesce */ }
        }

        /// <summary>
        /// Wait until <see cref="Notify"/> is called or <paramref name="timeout"/> elapses
        /// (whichever comes first). The timeout preserves the periodic safety-net poll.
        /// </summary>
        public async Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken)
        {
            try
            {
                await _semaphore.WaitAsync(timeout, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                // Shutdown — let the processor loop observe cancellation and exit.
            }
        }
    }
}

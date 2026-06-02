using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Planora.BuildingBlocks.Infrastructure.Outbox
{
    /// <summary>
    /// Pulses the <see cref="OutboxSignal"/> immediately after a transaction that inserted one or
    /// more <see cref="OutboxMessage"/> rows commits, so the <see cref="OutboxProcessor"/> dispatches
    /// them without waiting out the idle poll interval.
    ///
    /// The "did this save insert an outbox row?" decision is captured in <c>SavingChanges</c> (where
    /// the entries are still <see cref="EntityState.Added"/>) and acted on in <c>SavedChanges</c>
    /// (after the implicit transaction has committed, so the rows are visible to the processor's
    /// query). Registered <b>scoped</b> — one instance per DbContext scope — so the captured flag is
    /// never shared across concurrent requests.
    /// </summary>
    public sealed class OutboxNotifyInterceptor : SaveChangesInterceptor
    {
        private readonly OutboxSignal _signal;
        private bool _pendingOutboxInsert;

        public OutboxNotifyInterceptor(OutboxSignal signal) => _signal = signal;

        public override InterceptionResult<int> SavingChanges(
            DbContextEventData eventData, InterceptionResult<int> result)
        {
            _pendingOutboxInsert = HasOutboxInsert(eventData.Context);
            return base.SavingChanges(eventData, result);
        }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
        {
            _pendingOutboxInsert = HasOutboxInsert(eventData.Context);
            return base.SavingChangesAsync(eventData, result, cancellationToken);
        }

        public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
        {
            FlushSignal();
            return base.SavedChanges(eventData, result);
        }

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            FlushSignal();
            return base.SavedChangesAsync(eventData, result, cancellationToken);
        }

        public override void SaveChangesFailed(DbContextErrorEventData eventData)
        {
            _pendingOutboxInsert = false;
            base.SaveChangesFailed(eventData);
        }

        public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
        {
            _pendingOutboxInsert = false;
            return base.SaveChangesFailedAsync(eventData, cancellationToken);
        }

        private void FlushSignal()
        {
            if (!_pendingOutboxInsert) return;
            _pendingOutboxInsert = false;
            _signal.Notify();
        }

        private static bool HasOutboxInsert(DbContext? context) =>
            context is not null &&
            context.ChangeTracker.Entries<OutboxMessage>().Any(e => e.State == EntityState.Added);
    }
}

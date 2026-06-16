namespace Planora.Realtime.Application.Requests
{
    /// <summary>
    /// Body for "mark notifications read". Exactly one selector is honored, in priority order:
    /// <see cref="All"/> → <see cref="TaskId"/> → <see cref="Ids"/>. Used by the card-open
    /// (per-task), the bell's "mark all read", and individual list-item reads.
    /// </summary>
    public sealed record MarkNotificationsReadRequest
    {
        /// <summary>Mark every unread notification read.</summary>
        public bool All { get; init; }

        /// <summary>Mark every unread notification for this task read (card open / branch view).</summary>
        public Guid? TaskId { get; init; }

        /// <summary>Mark these specific notifications read (individual list items).</summary>
        public IReadOnlyList<Guid>? Ids { get; init; }
    }
}

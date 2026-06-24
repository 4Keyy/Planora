using Microsoft.EntityFrameworkCore;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Response;
using Planora.Realtime.Infrastructure.Persistence;

namespace Planora.Realtime.Infrastructure.Services;

/// <summary>
/// Postgres-backed read side of the notification log. All queries are <c>AsNoTracking</c> and filter
/// on the recipient id supplied by the caller (the JWT subject), so they are both fast and
/// IDOR-safe. Mark-read uses a single bulk <c>ExecuteUpdate</c> — no entities are loaded into the
/// change tracker.
/// </summary>
public sealed class NotificationReadStore : INotificationReadStore
{
    // Caps the per-task breakdown scan. A user's unread set is naturally small (they read them); the
    // cap only bounds a pathological backlog, and the exact total is still counted separately.
    private const int SummaryScanCap = 1000;
    private const int MaxPageSize = 100;

    private readonly RealtimeDbContext _db;

    public NotificationReadStore(RealtimeDbContext db) => _db = db;

    public async Task<NotificationSummary> GetSummaryAsync(Guid userId, CancellationToken cancellationToken = default)
    {
        var totalUnread = await _db.Notifications.AsNoTracking()
            .CountAsync(n => n.UserId == userId && !n.IsRead, cancellationToken);

        if (totalUnread == 0)
            return NotificationSummary.Empty;

        // Group the (small) unread set by task in memory: newest-first, so the first Type seen per
        // task is its latest — which drives the card's glyph (e.g. review vs. plain dot).
        var unread = await _db.Notifications.AsNoTracking()
            .Where(n => n.UserId == userId && !n.IsRead && n.TaskId != Guid.Empty)
            .OrderByDescending(n => n.OccurredOnUtc)
            .Select(n => new { n.TaskId, n.Type, n.OccurredOnUtc })
            .Take(SummaryScanCap)
            .ToListAsync(cancellationToken);

        var perTask = unread
            .GroupBy(x => x.TaskId)
            .Select(g =>
            {
                // Per-type breakdown, newest type first — the card renders one disc per type.
                var groups = g
                    .GroupBy(x => x.Type)
                    .Select(tg => new TaskUnreadGroup(tg.Key, tg.Count(), tg.Max(x => x.OccurredOnUtc)))
                    .OrderByDescending(tg => tg.LatestOccurredOnUtc)
                    .ToList();
                // groups is never empty (the task has ≥1 unread); Groups[0].Type is the latest type.
                return new TaskUnread(g.Key, g.Count(), groups[0].Type, groups);
            })
            .ToList();

        return new NotificationSummary(totalUnread, perTask);
    }

    public async Task<IReadOnlyList<NotificationPayload>> GetListAsync(
        Guid userId, int take, DateTime? before, CancellationToken cancellationToken = default)
    {
        take = Math.Clamp(take, 1, MaxPageSize);

        var query = _db.Notifications.AsNoTracking().Where(n => n.UserId == userId);
        if (before.HasValue)
            query = query.Where(n => n.OccurredOnUtc < before.Value);

        return await query
            .OrderByDescending(n => n.OccurredOnUtc)
            .Take(take)
            .Select(n => new NotificationPayload(
                n.Id, n.UserId, n.TaskId, n.ActorId, n.Type, n.Title, n.Message, n.OccurredOnUtc, n.IsRead))
            .ToListAsync(cancellationToken);
    }

    public async Task<NotificationSummary> MarkReadAsync(
        Guid userId,
        bool all,
        Guid? taskId,
        IReadOnlyList<Guid>? ids,
        CancellationToken cancellationToken = default)
    {
        var query = _db.Notifications.Where(n => n.UserId == userId && !n.IsRead);

        if (all)
        {
            // whole unread set
        }
        else if (taskId.HasValue)
        {
            query = query.Where(n => n.TaskId == taskId.Value);
        }
        else if (ids is { Count: > 0 })
        {
            query = query.Where(n => ids.Contains(n.Id));
        }
        else
        {
            // No selector → nothing to mark; just report current state.
            return await GetSummaryAsync(userId, cancellationToken);
        }

        var now = DateTime.UtcNow;
        await query.ExecuteUpdateAsync(
            s => s.SetProperty(n => n.IsRead, true).SetProperty(n => n.ReadAtUtc, now),
            cancellationToken);

        return await GetSummaryAsync(userId, cancellationToken);
    }
}

/// <summary>
/// Empty read side for hosts without a configured database (test / ephemeral runs). Returns an empty
/// summary / list and treats mark-read as a no-op, so the notification endpoints degrade gracefully
/// instead of failing to resolve.
/// </summary>
public sealed class NullNotificationReadStore : INotificationReadStore
{
    public Task<NotificationSummary> GetSummaryAsync(Guid userId, CancellationToken cancellationToken = default)
        => Task.FromResult(NotificationSummary.Empty);

    public Task<IReadOnlyList<NotificationPayload>> GetListAsync(
        Guid userId, int take, DateTime? before, CancellationToken cancellationToken = default)
        => Task.FromResult<IReadOnlyList<NotificationPayload>>(System.Array.Empty<NotificationPayload>());

    public Task<NotificationSummary> MarkReadAsync(
        Guid userId, bool all, Guid? taskId, IReadOnlyList<Guid>? ids, CancellationToken cancellationToken = default)
        => Task.FromResult(NotificationSummary.Empty);
}

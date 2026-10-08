using Microsoft.Extensions.Hosting;
using Planora.Todo.Application.Common;
using Planora.Todo.Application.Services;

namespace Planora.Todo.Infrastructure.Services;

/// <summary>Freezes legacy All friends roots and their children without changing their creation times.</summary>
public sealed class AllFriendsSnapshotBackfillService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AllFriendsSnapshotBackfillService> _logger;
    private readonly int _batchSize;

    public AllFriendsSnapshotBackfillService(
        IServiceScopeFactory scopeFactory,
        ILogger<AllFriendsSnapshotBackfillService> logger,
        int batchSize = 64)
    {
        ArgumentNullException.ThrowIfNull(scopeFactory);
        ArgumentNullException.ThrowIfNull(logger);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(batchSize);
        _scopeFactory = scopeFactory;
        _logger = logger;
        _batchSize = batchSize;
    }

    /// <returns>True when no legacy roots remain; false when another pass is needed.</returns>
    public async Task<bool> RunPassAsync(CancellationToken cancellationToken = default)
    {
        Guid? afterId = null;
        var retryNeeded = false;
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<TodoDbContext>();
            var query = LegacyRoots(db.TodoItems);
            if (afterId is Guid boundary)
                query = query.Where(todo => todo.Id.CompareTo(boundary) > 0);

            var roots = await query.OrderBy(todo => todo.Id).Take(_batchSize)
                .Include(todo => todo.SharedWith).Include(todo => todo.Workers)
                .AsSplitQuery().ToListAsync(cancellationToken);
            if (roots.Count == 0)
                return !retryNeeded && !await LegacyRoots(db.TodoItems).AsNoTracking().AnyAsync(cancellationToken);

            // Advance even on failure: a single unavailable owner must not starve later batches.
            afterId = roots[^1].Id;
            try
            {
                var client = scope.ServiceProvider.GetRequiredService<IFriendshipService>();
                var friendships = new Dictionary<Guid, IReadOnlyList<FriendshipInfo>>();
                foreach (var ownerId in roots.Select(todo => todo.UserId).Distinct())
                    friendships[ownerId] = await client.GetFriendshipsAsync(ownerId, cancellationToken);

                // No aggregate is mutated until every Auth lookup in this batch succeeds.
                var rootIds = roots.Select(todo => todo.Id).ToArray();
                var children = await db.TodoItems
                    .Where(todo => !todo.IsDeleted && todo.ParentTodoId != null && rootIds.Contains(todo.ParentTodoId.Value))
                    .Include(todo => todo.SharedWith).Include(todo => todo.Workers)
                    .AsSplitQuery().ToListAsync(cancellationToken);
                foreach (var parent in roots)
                {
                    parent.FreezeAllFriendsAudience(
                        AllFriendsSnapshotAudience.ForLegacy(parent, friendships[parent.UserId]), parent.CreatedAt);
                    foreach (var child in children.Where(todo => todo.ParentTodoId == parent.Id))
                        child.SyncInheritedFromParent(parent, parent.UserId);
                }

                // EF commits all roots, shares, children and worker evictions in one transaction.
                // xmin rejects a concurrent edit; a fresh scope on retry reloads the winning state.
                await db.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Froze {RootCount} legacy All friends roots and {ChildCount} children",
                    roots.Count, children.Count);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception error)
            {
                retryNeeded = true;
                _logger.LogWarning(error, "Legacy All friends batch deferred; it will be retried without freezing an incomplete audience");
            }
            finally
            {
                db.ChangeTracker.Clear();
            }
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var delay = TimeSpan.FromSeconds(1);
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (await RunPassAsync(stoppingToken)) return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception error)
            {
                _logger.LogWarning(error, "Legacy All friends backfill could not finish; retrying after {Delay}", delay);
            }

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            delay = TimeSpan.FromSeconds(Math.Min(delay.TotalSeconds * 2, 60));
        }
    }

    private static IQueryable<TodoItem> LegacyRoots(IQueryable<TodoItem> query) =>
        query.Where(todo => !todo.IsDeleted && todo.ParentTodoId == null && todo.IsPublic && todo.AllFriendsSnapshotAt == null);
}

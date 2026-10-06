using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.Auth.Domain.Entities;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.Auth.Infrastructure.Retention
{
    /// <summary>
    /// Bespoke soft-delete purge for user accounts. Account deletion is soft-delete only
    /// (<c>DeleteUserCommandHandler</c>), so — like every other soft-deletable entity — a deleted account
    /// must be physically removed once past <see cref="RetentionOptions.SoftDeleteGraceDays"/>. It cannot use
    /// the generic <c>SoftDeletedPurgePolicy&lt;User&gt;</c> because dependent rows would block or orphan the
    /// delete: <see cref="Friendship"/> has a <c>RESTRICT</c> FK to <c>User</c>, and
    /// <c>PasswordHistory</c>'s FK is intentionally not declared. So this removes every Auth-owned dependent
    /// row first (friendships first, since RESTRICT) and then the user.
    /// </summary>
    /// <remarks>
    /// The cross-service cascade (<c>UserDeletedIntegrationEvent</c> → Todo/Category/Collaboration/Realtime)
    /// already ran when the account was soft-deleted, so this pass re-publishes nothing — it only reclaims
    /// Auth's own storage. Audit-log rows (no FK, `EntityId` only) are deliberately kept as the forensic
    /// record of the deletion. Enabled by default but, like the whole subsystem, inert until the master
    /// switch is on and dry-run is off; set <see cref="RetentionOptions.PurgeDeletedUsers"/> false where
    /// legal/GDPR policy requires retaining deleted-account records.
    /// </remarks>
    public sealed class UserSoftDeletePurgePolicy : IRetentionPolicy
    {
        private readonly IRetentionLock _lock;
        private readonly ILogger<UserSoftDeletePurgePolicy> _logger;

        public UserSoftDeletePurgePolicy(IRetentionLock retentionLock, ILogger<UserSoftDeletePurgePolicy> logger)
        {
            _lock = retentionLock;
            _logger = logger;
        }

        public string Name => "soft-delete-purge:User";

        public bool IsEnabled(RetentionOptions options) => options.PurgeDeletedUsers;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            var db = scopedServices.GetRequiredService<DbContext>();
            var cutoff = context.UtcNow.AddDays(-context.Options.SoftDeleteGraceDays);

            return RetentionExecutor.RunAsync(
                Name, db, _lock, context,
                ct => db.Set<User>().IgnoreQueryFilters().CountAsync(u => u.IsDeleted && u.DeletedAt < cutoff, ct),
                (batch, ct) => PurgeBatchAsync(db, cutoff, batch, ct),
                _logger, cancellationToken);
        }

        private static async Task<int> PurgeBatchAsync(DbContext db, DateTime cutoff, int batchSize, CancellationToken ct)
        {
            var ids = await db.Set<User>().IgnoreQueryFilters()
                .Where(u => u.IsDeleted && u.DeletedAt < cutoff)
                .OrderBy(u => u.DeletedAt)
                .Select(u => u.Id)
                .Take(batchSize)
                .ToListAsync(ct);

            if (ids.Count == 0)
                return 0;

            // Dependents first. IgnoreQueryFilters throughout: several of these tables filter on
            // !User.IsDeleted, which would otherwise HIDE exactly the rows (owned by deleted users) that
            // must go. Friendship first — its FK to User is RESTRICT, so the user row cannot be removed
            // while a friendship still references it.
            await db.Set<Friendship>().IgnoreQueryFilters()
                .Where(f => ids.Contains(f.RequesterId) || ids.Contains(f.AddresseeId)).ExecuteDeleteAsync(ct);
            await db.Set<RefreshToken>().IgnoreQueryFilters().Where(t => ids.Contains(t.UserId)).ExecuteDeleteAsync(ct);
            await db.Set<LoginHistory>().IgnoreQueryFilters().Where(l => ids.Contains(l.UserId)).ExecuteDeleteAsync(ct);
            await db.Set<PasswordHistory>().IgnoreQueryFilters().Where(p => ids.Contains(p.UserId)).ExecuteDeleteAsync(ct);
            await db.Set<UserRecoveryCode>().IgnoreQueryFilters().Where(c => ids.Contains(c.UserId)).ExecuteDeleteAsync(ct);
            await db.Set<UserRole>().IgnoreQueryFilters().Where(r => ids.Contains(r.UserId)).ExecuteDeleteAsync(ct);

            return await db.Set<User>().IgnoreQueryFilters().Where(u => ids.Contains(u.Id)).ExecuteDeleteAsync(ct);
        }
    }
}

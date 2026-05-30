namespace Planora.Messaging.Infrastructure.Persistence.Repositories
{
    /// <summary>
    /// Compatibility adapter preserved across Phase 2 T2.3 consolidation. The class
    /// had no concrete extenders at the time of audit (every Messaging repository
    /// already derived from the canonical
    /// <see cref="Planora.BuildingBlocks.Infrastructure.Persistence.BaseRepository{TEntity, TId, TContext}"/>),
    /// so this surface is kept only to avoid breaking any out-of-tree consumer that
    /// may have referenced the older signature. Will be removed one release after
    /// T2.3 closes.
    /// </summary>
    [Obsolete("Derive from Planora.BuildingBlocks.Infrastructure.Persistence.BaseRepository<T, Guid, MessagingDbContext> directly. Will be removed.")]
    public abstract class BaseRepository<T>
        : Planora.BuildingBlocks.Infrastructure.Persistence.BaseRepository<T, Guid, MessagingDbContext>
        where T : BaseEntity
    {
        protected MessagingDbContext _context => Context;
        protected DbSet<T> _dbSet => DbSet;

        protected BaseRepository(MessagingDbContext context) : base(context)
        {
        }
    }
}

namespace Planora.Auth.Infrastructure.Persistence.Repositories
{
    /// <summary>
    /// Compatibility adapter that preserves the Auth-side <c>BaseRepository&lt;T&gt;</c>
    /// surface (constructor signature, <c>_context</c> and <c>_dbSet</c> protected aliases,
    /// Auth's historical Update semantics) while delegating actual behaviour to the
    /// canonical <see cref="Planora.BuildingBlocks.Infrastructure.Persistence.BaseRepository{TEntity, TId, TContext}"/>.
    /// </summary>
    /// <remarks>
    /// Kept <c>[Obsolete]</c> for one release. New repositories should derive directly:
    /// <code>
    /// public sealed class MyRepository
    ///     : Planora.BuildingBlocks.Infrastructure.Persistence.BaseRepository&lt;MyEntity, Guid, AuthDbContext&gt;,
    ///       IMyRepository
    /// { ... }
    /// </code>
    /// Soft-delete: Auth configures <c>HasQueryFilter</c> on every soft-deletable entity
    /// (User, Friendship, RefreshToken, LoginHistory, PasswordHistory). The canonical
    /// base adds an explicit <c>!IsDeleted</c> predicate on top, which the SQL optimiser
    /// collapses with the global filter — no behavioural change, just defence in depth.
    /// </remarks>
    [Obsolete("Derive from Planora.BuildingBlocks.Infrastructure.Persistence.BaseRepository<T, Guid, AuthDbContext> directly. This adapter will be removed in the release after Phase 2 T2.3 lands.")]
    public abstract class BaseRepository<T>
        : Planora.BuildingBlocks.Infrastructure.Persistence.BaseRepository<T, Guid, AuthDbContext>,
          IRepository<T>
        where T : BaseEntity
    {
        /// <summary>
        /// Historical Auth-side handle for the DbContext. Read-only — assignment is
        /// not supported (subclasses never wrote to it, they only read).
        /// </summary>
        protected AuthDbContext _context => Context;

        /// <summary>
        /// Historical Auth-side handle for the entity DbSet. Same read-only contract
        /// as <see cref="_context"/>.
        /// </summary>
        protected DbSet<T> _dbSet => DbSet;

        protected BaseRepository(AuthDbContext context) : base(context)
        {
        }

        /// <summary>
        /// Auth historically marked only the root entity as <see cref="EntityState.Modified"/>,
        /// leaving tracked navigation graphs untouched. The canonical base uses
        /// <see cref="DbSet{TEntity}.Update"/>, which marks the entire graph. We preserve
        /// the narrower behaviour here so existing Auth concrete repositories that load
        /// User with Include(u =&gt; u.RefreshTokens) and then Update(user) do not
        /// accidentally overwrite the refresh-token states.
        /// </summary>
        public override void Update(T entity)
        {
            Context.Entry(entity).State = EntityState.Modified;
        }

        public override void UpdateRange(IEnumerable<T> entities)
        {
            foreach (var entity in entities)
            {
                Context.Entry(entity).State = EntityState.Modified;
            }
        }
    }
}

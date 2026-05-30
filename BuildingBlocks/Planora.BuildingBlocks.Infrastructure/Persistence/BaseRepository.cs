using Planora.BuildingBlocks.Domain.Specifications;
using Planora.BuildingBlocks.Infrastructure.Specifications;
using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.BuildingBlocks.Infrastructure.Persistence
{
    /// <summary>
    /// Canonical repository base. Single source of truth for soft-delete handling,
    /// AsNoTracking discipline on read queries, pagination, and specification dispatch.
    /// Service-side per-context adapters (Auth/Messaging) wrap this with a thin
    /// concrete-typed shim only to expose the service's own DbContext to subclasses.
    /// </summary>
    /// <remarks>
    /// Soft-delete strategy:
    ///   - This base applies an explicit <c>!IsDeleted</c> predicate on every read.
    ///   - Services that ALSO configure <c>HasQueryFilter</c> (Auth) get redundant
    ///     filtering — harmless because the SQL optimiser collapses it.
    ///   - Services without HasQueryFilter (Todo) rely solely on this predicate.
    ///   - <see cref="GetByIdAsync"/> intentionally does not use AsNoTracking so
    ///     the returned entity is trackable for subsequent mutations.
    /// </remarks>
    public abstract class BaseRepository<TEntity, TId, TContext> : IRepository<TEntity, TId>
        where TEntity : BaseEntity
        where TContext : DbContext
    {
        protected readonly TContext Context;
        protected readonly DbSet<TEntity> DbSet;

        protected BaseRepository(TContext context)
        {
            Context = context ?? throw new ArgumentNullException(nameof(context));
            DbSet = context.Set<TEntity>();
        }

        public virtual async Task<TEntity?> GetByIdAsync(TId id, CancellationToken cancellationToken = default)
        {
            // Use FirstOrDefaultAsync instead of FindAsync for consistent cross-provider behaviour.
            // FindAsync's identity-map short-circuit works poorly with EF Core InMemory in integration
            // tests (returns null for entities just saved by a different scope), whereas
            // FirstOrDefaultAsync always goes to the store and works correctly everywhere.
            // The !IsDeleted predicate keeps GetByIdAsync consistent with every other query
            // method on this base — a soft-deleted entity must never be returned by id.
            // No AsNoTracking: callers typically chain Update on the result.
            var guidId = (Guid)(object)id!;
            return await DbSet.FirstOrDefaultAsync(e => e.Id == guidId && !e.IsDeleted, cancellationToken);
        }

        public virtual async Task<IReadOnlyList<TEntity>> GetAllAsync(CancellationToken cancellationToken = default)
        {
            // INV-DATA-3: AsNoTracking on read queries. Mutation flows must use
            // GetByIdAsync (tracking) or a service-side query that opts back into tracking.
            return await DbSet.AsNoTracking().Where(e => !e.IsDeleted).ToListAsync(cancellationToken);
        }

        public virtual async Task<IReadOnlyList<TEntity>> FindAsync(
            Expression<Func<TEntity, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await DbSet.AsNoTracking().Where(predicate).Where(e => !e.IsDeleted).ToListAsync(cancellationToken);
        }

        public virtual async Task<TEntity?> FindFirstAsync(
            Expression<Func<TEntity, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await DbSet.AsNoTracking().Where(predicate).Where(e => !e.IsDeleted).FirstOrDefaultAsync(cancellationToken);
        }

        public virtual async Task<bool> ExistsAsync(
            Expression<Func<TEntity, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await DbSet.AsNoTracking().Where(e => !e.IsDeleted).AnyAsync(predicate, cancellationToken);
        }

        public virtual async Task<int> CountAsync(
            Expression<Func<TEntity, bool>>? predicate = null,
            CancellationToken cancellationToken = default)
        {
            if (predicate == null)
                return await DbSet.AsNoTracking().Where(e => !e.IsDeleted).CountAsync(cancellationToken);

            return await DbSet.AsNoTracking().Where(e => !e.IsDeleted).CountAsync(predicate, cancellationToken);
        }

        public virtual async Task<TEntity> AddAsync(TEntity entity, CancellationToken cancellationToken = default)
        {
            await DbSet.AddAsync(entity, cancellationToken);
            return entity;
        }

        public virtual async Task AddRangeAsync(IEnumerable<TEntity> entities, CancellationToken cancellationToken = default)
        {
            await DbSet.AddRangeAsync(entities, cancellationToken);
        }

        public virtual async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return await Context.SaveChangesAsync(cancellationToken);
        }

        public virtual void Update(TEntity entity)
        {
            DbSet.Update(entity);
        }

        public virtual void UpdateRange(IEnumerable<TEntity> entities)
        {
            DbSet.UpdateRange(entities);
        }

        public virtual void Remove(TEntity entity)
        {
            DbSet.Remove(entity);
        }

        public virtual void RemoveRange(IEnumerable<TEntity> entities)
        {
            DbSet.RemoveRange(entities);
        }

        public virtual async Task<(IReadOnlyList<TEntity> Items, int TotalCount)> GetPagedAsync(
            int pageNumber,
            int pageSize,
            Expression<Func<TEntity, bool>>? predicate = null,
            Expression<Func<TEntity, object>>? orderBy = null,
            bool ascending = true,
            CancellationToken cancellationToken = default)
        {
            var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);
            var query = DbSet.AsNoTracking().Where(e => !e.IsDeleted).AsQueryable();

            if (predicate != null)
                query = query.Where(predicate);

            var totalCount = await query.CountAsync(cancellationToken);

            if (orderBy != null)
            {
                query = ascending
                    ? query.OrderBy(orderBy)
                    : query.OrderByDescending(orderBy);
            }

            var items = await query
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }

        protected async Task<TEntity?> GetBySpecificationAsync(
            ISpecification<TEntity> spec,
            CancellationToken cancellationToken = default)
        {
            return await ApplySpecification(spec).FirstOrDefaultAsync(cancellationToken);
        }

        protected async Task<IReadOnlyList<TEntity>> ListAsync(
            ISpecification<TEntity> spec,
            CancellationToken cancellationToken = default)
        {
            return await ApplySpecification(spec).ToListAsync(cancellationToken);
        }

        protected async Task<int> CountAsync(
            ISpecification<TEntity> spec,
            CancellationToken cancellationToken = default)
        {
            return await ApplySpecification(spec).CountAsync(cancellationToken);
        }

        private IQueryable<TEntity> ApplySpecification(ISpecification<TEntity> spec)
        {
            return SpecificationEvaluator.GetQuery(DbSet.AsQueryable(), spec);
        }
    }
}

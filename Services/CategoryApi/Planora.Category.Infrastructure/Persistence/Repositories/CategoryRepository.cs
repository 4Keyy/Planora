using Planora.BuildingBlocks.Application.Pagination;

namespace Planora.Category.Infrastructure.Persistence.Repositories
{
    public sealed class CategoryRepository : ICategoryRepository
    {
        private readonly CategoryDbContext _context;

        public CategoryRepository(CategoryDbContext context)
        {
            _context = context;
        }

        // No AsNoTracking: the Update/Delete command handlers load via GetByIdAsync then mutate,
        // so the returned entity must be change-tracked (INV-DATA-3).
        public async Task<Domain.Entities.Category?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default)
        {
            return await _context.Categories.FirstOrDefaultAsync(c => c.Id == id, cancellationToken);
        }

        public async Task<IReadOnlyList<Domain.Entities.Category>> GetAllAsync(CancellationToken cancellationToken = default)
        {
            return await _context.Categories.AsNoTracking().Where(c => !c.IsDeleted).ToListAsync(cancellationToken);
        }

        // No AsNoTracking: FindAsync is also used to fetch entities for RemoveRange/UpdateRange,
        // so the results must remain change-tracked.
        public async Task<IReadOnlyList<Domain.Entities.Category>> FindAsync(
            Expression<Func<Domain.Entities.Category, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await _context.Categories.Where(predicate).ToListAsync(cancellationToken);
        }

        public async Task<Domain.Entities.Category?> FindFirstAsync(
            Expression<Func<Domain.Entities.Category, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await _context.Categories.AsNoTracking().FirstOrDefaultAsync(predicate, cancellationToken);
        }

        public async Task<bool> ExistsAsync(
            Expression<Func<Domain.Entities.Category, bool>> predicate,
            CancellationToken cancellationToken = default)
        {
            return await _context.Categories.AnyAsync(predicate, cancellationToken);
        }

        public async Task<int> CountAsync(
            Expression<Func<Domain.Entities.Category, bool>>? predicate = null,
            CancellationToken cancellationToken = default)
        {
            var query = _context.Categories.AsQueryable();
            if (predicate != null)
                query = query.Where(predicate);

            return await query.CountAsync(cancellationToken);
        }

        public async Task<Domain.Entities.Category> AddAsync(Domain.Entities.Category entity, CancellationToken cancellationToken = default)
        {
            await _context.Categories.AddAsync(entity, cancellationToken);
            return entity;
        }

        public async Task AddRangeAsync(IEnumerable<Domain.Entities.Category> entities, CancellationToken cancellationToken = default)
        {
            await _context.Categories.AddRangeAsync(entities, cancellationToken);
        }

        public void Update(Domain.Entities.Category entity)
        {
            _context.Categories.Update(entity);
        }

        public void UpdateRange(IEnumerable<Domain.Entities.Category> entities)
        {
            _context.Categories.UpdateRange(entities);
        }

        public void Remove(Domain.Entities.Category entity)
        {
            _context.Categories.Remove(entity);
        }

        public void RemoveRange(IEnumerable<Domain.Entities.Category> entities)
        {
            _context.Categories.RemoveRange(entities);
        }

        public async Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
        {
            return await _context.SaveChangesAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<Domain.Entities.Category>> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await _context.Categories
                .AsNoTracking()
                .Where(c => c.UserId == userId && !c.IsDeleted)
                .OrderBy(c => c.Order)
                .ToListAsync(cancellationToken);
        }

        public async Task<IReadOnlyList<Domain.Entities.Category>> GetActiveByUserIdAsync(Guid userId, CancellationToken cancellationToken = default)
        {
            return await _context.Categories
                .AsNoTracking()
                .Where(c => c.UserId == userId && !c.IsDeleted && !c.IsArchived)
                .OrderBy(c => c.Order)
                .ToListAsync(cancellationToken);
        }

        // Read-only (used by the GetCategoryById query, never for mutation).
        public async Task<Domain.Entities.Category?> GetByIdAndUserIdAsync(Guid id, Guid userId, CancellationToken cancellationToken = default)
        {
            return await _context.Categories
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId && !c.IsDeleted, cancellationToken);
        }

        public async Task<bool> ExistsByNameAndUserIdAsync(string name, Guid userId, CancellationToken cancellationToken = default)
        {
            return await _context.Categories
                .AnyAsync(c => c.Name == name && c.UserId == userId && !c.IsDeleted, cancellationToken);
        }

        public async Task<(IReadOnlyList<Domain.Entities.Category> Items, int TotalCount)> GetPagedAsync(
            int pageNumber,
            int pageSize,
            Expression<Func<Domain.Entities.Category, bool>>? predicate = null,
            Expression<Func<Domain.Entities.Category, object>>? orderBy = null,
            bool ascending = true,
            CancellationToken cancellationToken = default)
        {
            var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);
            var query = _context.Categories.AsNoTracking().AsQueryable();

            if (predicate != null)
                query = query.Where(predicate);

            var totalCount = await query.CountAsync(cancellationToken);

            if (orderBy != null)
                query = ascending ? query.OrderBy(orderBy) : query.OrderByDescending(orderBy);

            var items = await query
                .Skip((safePageNumber - 1) * safePageSize)
                .Take(safePageSize)
                .ToListAsync(cancellationToken);

            return (items, totalCount);
        }
    }
}

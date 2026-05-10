namespace Planora.Category.Domain.Repositories
{
    public interface ICategoryRepository : IRepository<Entities.Category>
    {
        Task<IReadOnlyList<Entities.Category>> GetByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<IReadOnlyList<Entities.Category>> GetActiveByUserIdAsync(Guid userId, CancellationToken cancellationToken = default);
        Task<Entities.Category?> GetByIdAndUserIdAsync(Guid id, Guid userId, CancellationToken cancellationToken = default);
        Task<bool> ExistsByNameAndUserIdAsync(string name, Guid userId, CancellationToken cancellationToken = default);
    }
}

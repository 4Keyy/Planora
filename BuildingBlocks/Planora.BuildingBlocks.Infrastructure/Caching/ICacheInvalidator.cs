namespace Planora.BuildingBlocks.Infrastructure.Caching
{
    public interface ICacheInvalidator
    {
        Task InvalidateAsync(string key, CancellationToken cancellationToken = default);
        Task InvalidateByPatternAsync(string pattern, CancellationToken cancellationToken = default);
        Task InvalidateEntityAsync<TEntity>(Guid id, CancellationToken cancellationToken = default);
        Task InvalidateEntityListAsync<TEntity>(CancellationToken cancellationToken = default);
    }
}
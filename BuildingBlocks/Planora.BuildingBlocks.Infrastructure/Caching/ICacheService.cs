namespace Planora.BuildingBlocks.Infrastructure.Caching
{
    public interface ICacheService
    {
        Task<T?> GetAsync<T>(string key, CancellationToken cancellationToken = default);

        Task SetAsync<T>(
            string key,
            T value,
            TimeSpan? expiration = null,
            CancellationToken cancellationToken = default);

        /// <summary>Evicts this instance's local entry and attempts distributed removal.</summary>
        /// <remarks>Distributed failures are logged. Cancellation propagates after local eviction.</remarks>
        Task RemoveAsync(string key, CancellationToken cancellationToken = default);

        Task RemoveByPatternAsync(string pattern, CancellationToken cancellationToken = default);
    }
}

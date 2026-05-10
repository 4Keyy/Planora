namespace Planora.BuildingBlocks.Infrastructure.Caching
{
    public sealed class CacheOptions
    {
        public TimeSpan DefaultExpiration { get; set; } = TimeSpan.FromMinutes(30);

        public TimeSpan ShortExpiration { get; set; } = TimeSpan.FromMinutes(5);

        public TimeSpan LongExpiration { get; set; } = TimeSpan.FromHours(2);

        public bool EnableCompression { get; set; } = true;

        public bool UseLocalCache { get; set; } = true;

        public int LocalCacheSize { get; set; } = 1000;
    }
}

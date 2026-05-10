namespace Planora.BuildingBlocks.Infrastructure.Caching
{
    public static class CacheKeyBuilder
    {
        private const string Delimiter = ":";

        public static string Build(params object[] segments)
        {
            if (segments == null || segments.Length == 0)
                throw new ArgumentException("At least one segment is required", nameof(segments));

            return string.Join(Delimiter, segments.Select(s => s?.ToString() ?? "null"));
        }

        public static string ForEntity<TEntity>(Guid id)
        {
            return Build(typeof(TEntity).Name, id);
        }

        public static string ForEntityList<TEntity>(params object[] filters)
        {
            var segments = new List<object> { typeof(TEntity).Name, "list" };
            segments.AddRange(filters);
            return Build(segments.ToArray());
        }

        public static string PatternForEntity<TEntity>()
        {
            return $"{typeof(TEntity).Name}{Delimiter}*";
        }
    }
}

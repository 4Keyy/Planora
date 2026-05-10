namespace Planora.BuildingBlocks.Application.Pagination;

public static class PaginationExtensions
{
    public static IQueryable<T> ApplyPagination<T>(
        this IQueryable<T> query,
        int pageNumber,
        int pageSize)
    {
        var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);

        return query
            .Skip((safePageNumber - 1) * safePageSize)
            .Take(safePageSize);
    }

    public static async Task<PagedResult<T>> ToPagedResultAsync<T>(
        this IQueryable<T> query,
        int pageNumber,
        int pageSize,
        CancellationToken cancellationToken = default)
    {
        var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);
        var totalCount = await query.CountAsync(cancellationToken);
        var items = await query
            .ApplyPagination(safePageNumber, safePageSize)
            .ToListAsync(cancellationToken);

        return new PagedResult<T>(items, safePageNumber, safePageSize, totalCount);
    }
}

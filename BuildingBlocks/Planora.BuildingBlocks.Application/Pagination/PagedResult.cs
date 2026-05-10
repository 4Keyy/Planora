namespace Planora.BuildingBlocks.Application.Pagination;

public sealed class PagedResult<T>
{
    public IReadOnlyList<T> Items { get; }
    public int PageNumber { get; }
    public int PageSize { get; }
    public int TotalCount { get; }
    public int TotalPages { get; }
    public bool HasPreviousPage => PageNumber > 1;
    public bool HasNextPage => PageNumber < TotalPages;

    public PagedResult(
        IReadOnlyList<T> items,
        int pageNumber,
        int pageSize,
        int totalCount)
    {
        var (safePageNumber, safePageSize) = PaginationParameters.Normalize(pageNumber, pageSize);

        Items = items;
        PageNumber = safePageNumber;
        PageSize = safePageSize;
        TotalCount = totalCount;
        TotalPages = (int)Math.Ceiling(totalCount / (double)safePageSize);
    }

    public static PagedResult<T> Empty(int pageNumber, int pageSize)
        => new(Array.Empty<T>(), pageNumber, pageSize, 0);

    public PagedResult<TNew> Map<TNew>(Func<T, TNew> mapper)
    {
        var mappedItems = Items.Select(mapper).ToList();
        return new PagedResult<TNew>(mappedItems, PageNumber, PageSize, TotalCount);
    }
}

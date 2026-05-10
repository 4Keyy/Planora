namespace Planora.BuildingBlocks.Application.Pagination;

public static class PaginationParameters
{
    public const int DefaultPageNumber = 1;
    public const int DefaultPageSize = 10;
    public const int MaxPageSize = 100;

    public static (int PageNumber, int PageSize) Normalize(int pageNumber, int pageSize)
    {
        var normalizedPageNumber = pageNumber < DefaultPageNumber
            ? DefaultPageNumber
            : pageNumber;

        var normalizedPageSize = pageSize switch
        {
            < 1 => DefaultPageSize,
            > MaxPageSize => MaxPageSize,
            _ => pageSize
        };

        return (normalizedPageNumber, normalizedPageSize);
    }
}

namespace Planora.BuildingBlocks.Application.Pagination;

public abstract record PaginationQuery
{
    private int _pageSize = PaginationParameters.DefaultPageSize;
    private int _pageNumber = PaginationParameters.DefaultPageNumber;

    public int PageNumber
    {
        get => _pageNumber;
        init => _pageNumber = PaginationParameters.Normalize(value, _pageSize).PageNumber;
    }

    public int PageSize
    {
        get => _pageSize;
        init => _pageSize = PaginationParameters.Normalize(_pageNumber, value).PageSize;
    }

    public string? OrderBy { get; init; }
    public bool Ascending { get; init; } = true;
    public string? SearchTerm { get; init; }

    public int CalculateSkip() => (PageNumber - 1) * PageSize;
}

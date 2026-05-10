using Planora.BuildingBlocks.Application.Pagination;
using Microsoft.EntityFrameworkCore;

namespace Planora.UnitTests.BuildingBlocks;

public sealed class PaginationExtensionsTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public async Task ApplyPaginationAndToPagedResultAsync_ShouldSliceQueryAndPreserveMetadata()
    {
        await using var context = new PaginationTestDbContext(
            new DbContextOptionsBuilder<PaginationTestDbContext>()
                .UseInMemoryDatabase($"pagination-{Guid.NewGuid()}")
                .Options);
        context.Items.AddRange(Enumerable.Range(1, 7).Select(value => new PaginationItem { Value = value }));
        await context.SaveChangesAsync();

        var sliced = context.Items
            .OrderBy(item => item.Value)
            .ApplyPagination(pageNumber: 2, pageSize: 3)
            .Select(item => item.Value)
            .ToList();
        var paged = await context.Items
            .OrderBy(item => item.Value)
            .ToPagedResultAsync(pageNumber: 3, pageSize: 2);

        Assert.Equal(new[] { 4, 5, 6 }, sliced);
        Assert.Equal(3, paged.PageNumber);
        Assert.Equal(2, paged.PageSize);
        Assert.Equal(7, paged.TotalCount);
        Assert.Equal(4, paged.TotalPages);
        Assert.True(paged.HasPreviousPage);
        Assert.True(paged.HasNextPage);
        Assert.Equal(new[] { 5, 6 }, paged.Items.Select(item => item.Value));

        var empty = PagedResult<int>.Empty(pageNumber: 4, pageSize: 10);
        Assert.Empty(empty.Items);
        Assert.Equal(4, empty.PageNumber);
        Assert.Equal(10, empty.PageSize);
        Assert.Equal(0, empty.TotalCount);
        Assert.Equal(0, empty.TotalPages);
        Assert.True(empty.HasPreviousPage);
        Assert.False(empty.HasNextPage);

        var mapped = paged.Map(item => $"item-{item.Value}");
        Assert.Equal(new[] { "item-5", "item-6" }, mapped.Items);
        Assert.Equal(paged.PageNumber, mapped.PageNumber);
        Assert.Equal(paged.PageSize, mapped.PageSize);
        Assert.Equal(paged.TotalCount, mapped.TotalCount);

        var query = new TestPaginationQuery
        {
            PageNumber = 0,
            PageSize = 200,
            OrderBy = "Value",
            Ascending = false,
            SearchTerm = "needle"
        };
        Assert.Equal(1, query.PageNumber);
        Assert.Equal(100, query.PageSize);
        Assert.Equal("Value", query.OrderBy);
        Assert.False(query.Ascending);
        Assert.Equal("needle", query.SearchTerm);
        Assert.Equal(0, query.CalculateSkip());

        var normalizedSlice = context.Items
            .OrderBy(item => item.Value)
            .ApplyPagination(pageNumber: -3, pageSize: 500)
            .Select(item => item.Value)
            .ToList();
        var normalizedPaged = await context.Items
            .OrderBy(item => item.Value)
            .ToPagedResultAsync(pageNumber: 0, pageSize: 0);
        var normalizedEmpty = PagedResult<int>.Empty(pageNumber: 0, pageSize: 0);

        Assert.Equal(Enumerable.Range(1, 7), normalizedSlice);
        Assert.Equal(1, normalizedPaged.PageNumber);
        Assert.Equal(10, normalizedPaged.PageSize);
        Assert.Equal(new[] { 1, 2, 3, 4, 5, 6, 7 }, normalizedPaged.Items.Select(item => item.Value));
        Assert.Equal(1, normalizedEmpty.PageNumber);
        Assert.Equal(10, normalizedEmpty.PageSize);
    }

    private sealed record TestPaginationQuery : PaginationQuery;

    private sealed class PaginationTestDbContext(DbContextOptions<PaginationTestDbContext> options) : DbContext(options)
    {
        public DbSet<PaginationItem> Items => Set<PaginationItem>();
    }

    private sealed class PaginationItem
    {
        public int Id { get; set; }
        public int Value { get; set; }
    }
}

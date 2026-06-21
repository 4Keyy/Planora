using Planora.Auth.Domain.Enums;

namespace Planora.Auth.Domain.Repositories
{
    /// <summary>
    /// Server-side filter/sort/paging parameters for an administrative user listing. Passing
    /// this to the repository lets the database apply WHERE / ORDER BY / OFFSET / LIMIT instead
    /// of materialising every row and filtering in memory.
    /// </summary>
    public sealed record UserListFilter
    {
        public UserStatus? Status { get; init; }
        public string? SearchTerm { get; init; }
        public DateTime? CreatedFrom { get; init; }
        public DateTime? CreatedTo { get; init; }
        public string? OrderBy { get; init; }
        public bool Ascending { get; init; } = true;
        public int PageNumber { get; init; } = 1;
        public int PageSize { get; init; } = 20;
    }
}

namespace Planora.Auth.Domain.Repositories
{
    /// <summary>
    /// Aggregate user counts computed by the database in a single pass, rather than by
    /// pulling the whole users table into memory. The time-window boundaries are supplied
    /// by the caller so "now" stays deterministic and testable.
    /// </summary>
    public sealed record UserStatisticsSnapshot(
        int TotalUsers,
        int ActiveUsers,
        int InactiveUsers,
        int LockedUsers,
        int UsersWithTwoFactor,
        int NewUsersToday,
        int NewUsersThisWeek,
        int NewUsersThisMonth)
    {
        public static UserStatisticsSnapshot Empty { get; } =
            new(0, 0, 0, 0, 0, 0, 0, 0);
    }
}

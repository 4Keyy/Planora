namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record UserStatisticsDto
    {
        public int TotalUsers { get; init; }

        public int ActiveUsers { get; init; }

        public int InactiveUsers { get; init; }

        public int LockedUsers { get; init; }

        public int UsersWithTwoFactor { get; init; }

        public int NewUsersToday { get; init; }

        public int NewUsersThisWeek { get; init; }

        public int NewUsersThisMonth { get; init; }

        public DateTime LastUpdated { get; init; }
    }
}

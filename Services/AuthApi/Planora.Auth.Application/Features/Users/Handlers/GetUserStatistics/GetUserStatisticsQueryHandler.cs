using Planora.Auth.Application.Features.Users.Queries.GetUserStatistics;

namespace Planora.Auth.Application.Features.Users.Handlers.GetUserStatistics
{
    public sealed class GetUserStatisticsQueryHandler : IRequestHandler<GetUserStatisticsQuery, Result<UserStatisticsDto>>
    {
        private readonly IUserRepository _userRepository;
        private readonly ILogger<GetUserStatisticsQueryHandler> _logger;

        public GetUserStatisticsQueryHandler(
            IUserRepository userRepository,
            ILogger<GetUserStatisticsQueryHandler> logger)
        {
            _userRepository = userRepository;
            _logger = logger;
        }

        public async Task<Result<UserStatisticsDto>> Handle(
            GetUserStatisticsQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                var now = DateTime.UtcNow;

                var snapshot = await _userRepository.GetStatisticsAsync(
                    now.Date,
                    now.AddDays(-7),
                    now.AddMonths(-1),
                    cancellationToken);

                var stats = new UserStatisticsDto
                {
                    TotalUsers = snapshot.TotalUsers,
                    ActiveUsers = snapshot.ActiveUsers,
                    InactiveUsers = snapshot.InactiveUsers,
                    LockedUsers = snapshot.LockedUsers,
                    UsersWithTwoFactor = snapshot.UsersWithTwoFactor,
                    NewUsersToday = snapshot.NewUsersToday,
                    NewUsersThisWeek = snapshot.NewUsersThisWeek,
                    NewUsersThisMonth = snapshot.NewUsersThisMonth,
                    LastUpdated = now
                };

                return Result.Success(stats);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving user statistics");
                return Result.Failure<UserStatisticsDto>(
                    Error.InternalServer("GET_STATS_ERROR", "An error occurred while retrieving statistics"));
            }
        }
    }
}

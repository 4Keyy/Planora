using Planora.Auth.Application.Features.Users.Queries.GetUserStatistics;
using Planora.Auth.Domain.Enums;

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
                var allUsers = await _userRepository.GetAllAsync(cancellationToken);

                var now = DateTime.UtcNow;
                var today = now.Date;
                var weekAgo = now.AddDays(-7);
                var monthAgo = now.AddMonths(-1);

                var stats = new UserStatisticsDto
                {
                    TotalUsers = allUsers.Count,
                    ActiveUsers = allUsers.Count(u => u.Status == UserStatus.Active),
                    InactiveUsers = allUsers.Count(u => u.Status == UserStatus.Inactive),
                    LockedUsers = allUsers.Count(u => u.Status == UserStatus.Locked),
                    UsersWithTwoFactor = allUsers.Count(u => u.TwoFactorEnabled),
                    NewUsersToday = allUsers.Count(u => u.CreatedAt >= today),
                    NewUsersThisWeek = allUsers.Count(u => u.CreatedAt >= weekAgo),
                    NewUsersThisMonth = allUsers.Count(u => u.CreatedAt >= monthAgo),
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

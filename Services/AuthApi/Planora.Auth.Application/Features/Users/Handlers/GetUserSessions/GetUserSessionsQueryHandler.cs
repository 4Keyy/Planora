using Planora.Auth.Application.Features.Users.Queries.GetUserSessions;

namespace Planora.Auth.Application.Features.Users.Handlers.GetUserSessions
{
    public sealed class GetUserSessionsQueryHandler : IRequestHandler<GetUserSessionsQuery, Result<List<SessionDto>>>
    {
        private readonly IRefreshTokenRepository _refreshTokenRepository;
        private readonly ICurrentUserService _currentUserService;
        private readonly IMapper _mapper;
        private readonly ILogger<GetUserSessionsQueryHandler> _logger;

        public GetUserSessionsQueryHandler(
            IRefreshTokenRepository refreshTokenRepository,
            ICurrentUserService currentUserService,
            IMapper mapper,
            ILogger<GetUserSessionsQueryHandler> logger)
        {
            _refreshTokenRepository = refreshTokenRepository;
            _currentUserService = currentUserService;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Result<List<SessionDto>>> Handle(
            GetUserSessionsQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                if (!_currentUserService.UserId.HasValue)
                {
                    return Result.Failure<List<SessionDto>>(
                        Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
                }

                var activeTokens = await _refreshTokenRepository.GetActiveTokensByUserIdAsync(
                    _currentUserService.UserId.Value,
                    cancellationToken);

                var sessions = _mapper.Map<List<SessionDto>>(activeTokens);

                var currentIp = _currentUserService.IpAddress;
                var updatedSessions = sessions.Select(session =>
                    session with { IsCurrent = session.IpAddress == currentIp }
                ).ToList();

                return Result.Success(updatedSessions);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving user sessions");
                return Result.Failure<List<SessionDto>>(
                    Error.InternalServer("GET_SESSIONS_ERROR", "An error occurred while retrieving sessions"));
            }
        }
    }
}

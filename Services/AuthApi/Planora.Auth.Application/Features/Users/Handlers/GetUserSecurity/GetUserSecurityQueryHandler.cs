using Planora.Auth.Application.Features.Users.Queries.GetUserSecurity;

namespace Planora.Auth.Application.Features.Users.Handlers.GetUserSecurity
{
    public sealed class GetUserSecurityQueryHandler : IRequestHandler<GetUserSecurityQuery, Result<UserSecurityDto>>
    {
        private readonly IUserRepository _userRepository;
        private readonly IRefreshTokenRepository _refreshTokenRepository;
        private readonly ILoginHistoryRepository _loginHistoryRepository;
        private readonly ICurrentUserService _currentUserService;
        private readonly IMapper _mapper;
        private readonly ILogger<GetUserSecurityQueryHandler> _logger;

        public GetUserSecurityQueryHandler(
            IUserRepository userRepository,
            IRefreshTokenRepository refreshTokenRepository,
            ILoginHistoryRepository loginHistoryRepository,
            ICurrentUserService currentUserService,
            IMapper mapper,
            ILogger<GetUserSecurityQueryHandler> logger)
        {
            _userRepository = userRepository;
            _refreshTokenRepository = refreshTokenRepository;
            _loginHistoryRepository = loginHistoryRepository;
            _currentUserService = currentUserService;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Result<UserSecurityDto>> Handle(
            GetUserSecurityQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                if (!_currentUserService.UserId.HasValue)
                {
                    return Result.Failure<UserSecurityDto>(
                        Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
                }

                var user = await _userRepository.GetByIdAsync(
                    _currentUserService.UserId.Value,
                    cancellationToken);

                if (user == null)
                {
                    return Result.Failure<UserSecurityDto>(
                        Error.NotFound("USER_NOT_FOUND", "User not found"));
                }

                var activeTokens = await _refreshTokenRepository.GetActiveTokensByUserIdAsync(
                    user.Id,
                    cancellationToken);

                var recentLogins = await _loginHistoryRepository.GetByUserIdAsync(
                    user.Id,
                    10,
                    cancellationToken);

                var tokenDtos = _mapper.Map<List<RefreshTokenDetailDto>>(activeTokens);
                var loginDtos = _mapper.Map<List<LoginHistoryDto>>(recentLogins);

                var securityDto = new UserSecurityDto
                {
                    UserId = user.Id,
                    TwoFactorEnabled = user.TwoFactorEnabled,
                    ActiveSessionsCount = activeTokens.Count,
                    LastPasswordChange = user.UpdatedAt,
                    FailedLoginAttempts = user.FailedLoginAttempts,
                    LockedUntil = user.LockedUntil,
                    ActiveTokens = tokenDtos,
                    RecentLogins = loginDtos
                };

                return Result.Success(securityDto);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving user security info");
                return Result.Failure<UserSecurityDto>(
                    Error.InternalServer("GET_SECURITY_ERROR", "An error occurred while retrieving security info"));
            }
        }
    }
}

using Planora.Auth.Application.Features.Users.Queries.GetUser;

namespace Planora.Auth.Application.Features.Users.Handlers.GetUser
{
    public sealed class GetUserQueryHandler : IRequestHandler<GetUserQuery, Result<UserDetailDto>>
    {
        private readonly IUserRepository _userRepository;
        private readonly ILoginHistoryRepository _loginHistoryRepository;
        private readonly IMapper _mapper;
        private readonly ILogger<GetUserQueryHandler> _logger;

        public GetUserQueryHandler(
            IUserRepository userRepository,
            ILoginHistoryRepository loginHistoryRepository,
            IMapper mapper,
            ILogger<GetUserQueryHandler> logger)
        {
            _userRepository = userRepository;
            _loginHistoryRepository = loginHistoryRepository;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Result<UserDetailDto>> Handle(
            GetUserQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                var user = await _userRepository.GetByIdAsync(query.UserId, cancellationToken);

                if (user == null)
                {
                    return Result.Failure<UserDetailDto>(
                        Error.NotFound("USER_NOT_FOUND", $"User with ID {query.UserId} not found"));
                }

                var recentLogins = await _loginHistoryRepository.GetByUserIdAsync(
                    user.Id,
                    10,
                    cancellationToken);

                var userDto = _mapper.Map<UserDetailDto>(user);
                var loginDtos = _mapper.Map<List<LoginHistoryDto>>(recentLogins);

                userDto = userDto with { RecentLogins = loginDtos };

                return Result.Success(userDto);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving user: {UserId}", query.UserId);
                return Result.Failure<UserDetailDto>(
                    Error.InternalServer("GET_USER_ERROR", "An error occurred while retrieving user"));
            }
        }
    }
}

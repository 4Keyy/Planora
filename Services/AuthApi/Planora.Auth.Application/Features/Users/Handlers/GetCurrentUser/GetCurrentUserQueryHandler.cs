using Planora.Auth.Application.Features.Users.Queries.GetCurrentUser;

namespace Planora.Auth.Application.Features.Users.Handlers.GetCurrentUser
{
    public sealed class GetCurrentUserQueryHandler : IRequestHandler<GetCurrentUserQuery, Result<UserDto>>
    {
        private readonly IUserRepository _userRepository;
        private readonly ICurrentUserService _currentUserService;
        private readonly IMapper _mapper;
        private readonly ILogger<GetCurrentUserQueryHandler> _logger;

        public GetCurrentUserQueryHandler(
            IUserRepository userRepository,
            ICurrentUserService currentUserService,
            IMapper mapper,
            ILogger<GetCurrentUserQueryHandler> logger)
        {
            _userRepository = userRepository;
            _currentUserService = currentUserService;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Result<UserDto>> Handle(
            GetCurrentUserQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                if (!_currentUserService.UserId.HasValue)
                {
                    return Result.Failure<UserDto>(
                        Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
                }

                var user = await _userRepository.GetByIdAsync(
                    _currentUserService.UserId.Value,
                    cancellationToken);

                if (user == null)
                {
                    return Result.Failure<UserDto>(
                        Error.NotFound("USER_NOT_FOUND", "User not found"));
                }

                var userDto = _mapper.Map<UserDto>(user);
                return Result.Success(userDto);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving current user");
                return Result.Failure<UserDto>(
                    Error.InternalServer("GET_CURRENT_USER_ERROR", "An error occurred while retrieving current user"));
            }
        }
    }
}

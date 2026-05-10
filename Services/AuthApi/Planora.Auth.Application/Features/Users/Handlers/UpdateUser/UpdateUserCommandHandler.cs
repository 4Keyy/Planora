using Planora.Auth.Application.Features.Users.Commands.UpdateUser;

namespace Planora.Auth.Application.Features.Users.Handlers.UpdateUser
{
    public sealed class UpdateUserCommandHandler : IRequestHandler<UpdateUserCommand, Result<UserDto>>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ICurrentUserService _currentUserService;
        private readonly IMapper _mapper;
        private readonly ILogger<UpdateUserCommandHandler> _logger;

        public UpdateUserCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ICurrentUserService currentUserService,
            IMapper mapper,
            ILogger<UpdateUserCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Result<UserDto>> Handle(
            UpdateUserCommand command,
            CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
            {
                return Result.Failure<UserDto>(
                    Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
            }

            var user = await _unitOfWork.Users.GetByIdAsync(
                _currentUserService.UserId.Value,
                cancellationToken);

            if (user == null)
            {
                return Result.Failure<UserDto>(
                    Error.NotFound("USER_NOT_FOUND", "User not found"));
            }

            user.UpdateProfile(
                command.FirstName.Trim(),
                command.LastName.Trim(),
                command.ProfilePictureUrl,
                user.Id);

            _unitOfWork.Users.Update(user);

            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("User profile updated: {UserId}", user.Id);

            var userDto = _mapper.Map<UserDto>(user);
            return Result.Success(userDto);
        }
    }
}

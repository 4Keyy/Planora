using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Users.Commands.UploadAvatar;
using Planora.Auth.Domain.Repositories;
using AutoMapper;
using Microsoft.Extensions.Logging;

namespace Planora.Auth.Application.Features.Users.Handlers.UploadAvatar
{
    public sealed class UploadAvatarCommandHandler : IRequestHandler<UploadAvatarCommand, Planora.BuildingBlocks.Domain.Result<UserDto>>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ICurrentUserService _currentUserService;
        private readonly IAvatarStorage _avatarStorage;
        private readonly IImageProcessor _imageProcessor;
        private readonly IMapper _mapper;
        private readonly ILogger<UploadAvatarCommandHandler> _logger;

        public UploadAvatarCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ICurrentUserService currentUserService,
            IAvatarStorage avatarStorage,
            IImageProcessor imageProcessor,
            IMapper mapper,
            ILogger<UploadAvatarCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
            _avatarStorage = avatarStorage;
            _imageProcessor = imageProcessor;
            _mapper = mapper;
            _logger = logger;
        }

        public async Task<Planora.BuildingBlocks.Domain.Result<UserDto>> Handle(
            UploadAvatarCommand command,
            CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
            {
                return Planora.BuildingBlocks.Domain.Result<UserDto>.Failure(
                    Planora.BuildingBlocks.Domain.Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
            }

            var user = await _unitOfWork.Users.GetByIdAsync(
                _currentUserService.UserId.Value,
                cancellationToken);

            if (user == null)
            {
                return Planora.BuildingBlocks.Domain.Result<UserDto>.Failure(
                    Planora.BuildingBlocks.Domain.Error.NotFound("USER_NOT_FOUND", "User not found"));
            }

            await using var sourceStream = command.File.OpenReadStream();
            var processed = await _imageProcessor.ProcessAvatarAsync(
                sourceStream,
                command.File.Length,
                cancellationToken);

            if (processed.IsFailure)
            {
                _logger.LogInformation(
                    "Avatar upload rejected for user {UserId}: {Code} {Message}",
                    user.Id, processed.Error!.Code, processed.Error.Message);
                return Planora.BuildingBlocks.Domain.Result<UserDto>.Failure(processed.Error!);
            }

            var manifest = await _avatarStorage.PutAsync(user.Id, processed.Value!, cancellationToken);

            user.UpdateProfile(user.FirstName, user.LastName, manifest.CanonicalUrl, user.Id);
            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Avatar updated: UserId={UserId} Hash={Hash} CanonicalUrl={Url}",
                user.Id, manifest.ContentHash, manifest.CanonicalUrl);

            var userDto = _mapper.Map<UserDto>(user);
            return Planora.BuildingBlocks.Domain.Result<UserDto>.Success(userDto);
        }
    }
}

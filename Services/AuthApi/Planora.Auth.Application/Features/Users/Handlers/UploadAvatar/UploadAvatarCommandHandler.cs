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
        private const string AvatarFolder = "avatars";

        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ICurrentUserService _currentUserService;
        private readonly IFileStorageService _fileStorageService;
        private readonly IImageProcessor _imageProcessor;
        private readonly IMapper _mapper;
        private readonly ILogger<UploadAvatarCommandHandler> _logger;

        public UploadAvatarCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ICurrentUserService currentUserService,
            IFileStorageService fileStorageService,
            IImageProcessor imageProcessor,
            IMapper mapper,
            ILogger<UploadAvatarCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
            _fileStorageService = fileStorageService;
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

            // Replace old avatar only if it points at our managed folder.
            if (!string.IsNullOrEmpty(user.ProfilePictureUrl)
                && user.ProfilePictureUrl.StartsWith($"/{AvatarFolder}/", StringComparison.Ordinal))
            {
                _fileStorageService.DeleteFile(user.ProfilePictureUrl);
            }

            var image = processed.Value!;
            var storedFileName = $"avatar-{Guid.NewGuid():N}{image.Extension}";
            var avatarUrl = await _fileStorageService.SaveBytesAsync(
                image.Data,
                storedFileName,
                AvatarFolder,
                cancellationToken);

            user.UpdateProfile(user.FirstName, user.LastName, avatarUrl, user.Id);
            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Avatar updated: UserId={UserId} Url={AvatarUrl} Size={Bytes}B {Width}x{Height}",
                user.Id, avatarUrl, image.Data.Length, image.Width, image.Height);

            var userDto = _mapper.Map<UserDto>(user);
            return Planora.BuildingBlocks.Domain.Result<UserDto>.Success(userDto);
        }
    }
}

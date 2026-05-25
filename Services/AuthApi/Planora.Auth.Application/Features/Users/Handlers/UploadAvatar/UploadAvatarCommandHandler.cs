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
        private readonly IFileStorageService _fileStorageService;
        private readonly IMapper _mapper;
        private readonly ILogger<UploadAvatarCommandHandler> _logger;

        public UploadAvatarCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ICurrentUserService currentUserService,
            IFileStorageService fileStorageService,
            IMapper mapper,
            ILogger<UploadAvatarCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
            _fileStorageService = fileStorageService;
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

            // Delete old avatar if it exists and was uploaded locally
            if (!string.IsNullOrEmpty(user.ProfilePictureUrl) && user.ProfilePictureUrl.StartsWith("/avatars/"))
            {
                _fileStorageService.DeleteFile(user.ProfilePictureUrl);
            }

            // Save new avatar
            using var stream = command.File.OpenReadStream();
            var fileName = command.File.FileName;
            var avatarUrl = await _fileStorageService.SaveFileAsync(stream, fileName, "avatars", cancellationToken);

            // Update user profile
            user.UpdateProfile(user.FirstName, user.LastName, avatarUrl, user.Id);
            _unitOfWork.Users.Update(user);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation("User avatar updated: {UserId}, Path: {AvatarUrl}", user.Id, avatarUrl);

            var userDto = _mapper.Map<UserDto>(user);
            return Planora.BuildingBlocks.Domain.Result<UserDto>.Success(userDto);
        }
    }
}

using Planora.BuildingBlocks.Application.Models;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Repositories;
using Planora.BuildingBlocks.Domain.Interfaces;

namespace Planora.Auth.Application.Features.Friendships.Commands.RemoveFriend
{
    public sealed class RemoveFriendCommandHandler : IRequestHandler<RemoveFriendCommand, Result>
    {
        private readonly IFriendshipRepository _friendshipRepository;
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<RemoveFriendCommandHandler> _logger;

        public RemoveFriendCommandHandler(
            IFriendshipRepository friendshipRepository,
            IAuthUnitOfWork unitOfWork,
            ICurrentUserService currentUserService,
            ILogger<RemoveFriendCommandHandler> logger)
        {
            _friendshipRepository = friendshipRepository;
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result> Handle(RemoveFriendCommand request, CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
                return Result.Failure("AUTH_REQUIRED", "User context is not available");

            var userId = _currentUserService.UserId.Value;

            try
            {
                var friendship = await _friendshipRepository.GetFriendshipAsync(userId, request.FriendId, cancellationToken);
                if (friendship == null)
                    return Result.Failure("FRIENDSHIP_NOT_FOUND", "Friendship not found");

                if (friendship.Status != Domain.Enums.FriendshipStatus.Accepted)
                    return Result.Failure("NOT_FRIENDS", "Users are not friends");

                friendship.Remove(userId);
                _friendshipRepository.Update(friendship);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation("Friendship removed between {UserId} and {FriendId}", userId, request.FriendId);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to remove friendship between {UserId} and {FriendId}", userId, request.FriendId);
                return Result.Failure("REMOVE_FAILED", ex.Message);
            }
        }
    }
}


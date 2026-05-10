using Planora.BuildingBlocks.Application.Models;

namespace Planora.Auth.Application.Features.Friendships.Commands.RejectFriendRequest
{
    public sealed class RejectFriendRequestCommandHandler : IRequestHandler<RejectFriendRequestCommand, Result>
    {
        private readonly IFriendshipRepository _friendshipRepository;
        private readonly IApplicationDbContext _dbContext;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<RejectFriendRequestCommandHandler> _logger;

        public RejectFriendRequestCommandHandler(
            IFriendshipRepository friendshipRepository,
            IApplicationDbContext dbContext,
            ICurrentUserService currentUserService,
            ILogger<RejectFriendRequestCommandHandler> logger)
        {
            _friendshipRepository = friendshipRepository;
            _dbContext = dbContext;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result> Handle(RejectFriendRequestCommand request, CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
                return Result.Failure("AUTH_REQUIRED", "User context is not available");

            var userId = _currentUserService.UserId.Value;

            try
            {
                var friendship = await _friendshipRepository.GetByIdAsync(request.FriendshipId, cancellationToken);
                if (friendship == null)
                    return Result.Failure("FRIENDSHIP_NOT_FOUND", "Friendship request not found");

                if (friendship.AddresseeId != userId)
                    return Result.Failure("FORBIDDEN", "Only the addressee can reject the request");

                friendship.Reject(userId);
                _friendshipRepository.Update(friendship);
                await _dbContext.SaveChangesAsync(cancellationToken);

                _logger.LogInformation("Friend request {FriendshipId} rejected by {UserId}", request.FriendshipId, userId);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to reject friend request {FriendshipId}", request.FriendshipId);
                return Result.Failure("REJECT_FAILED", ex.Message);
            }
        }
    }
}


using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Services;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Auth.Application.Features.Friendships.Commands.AcceptFriendRequest
{
    public sealed class AcceptFriendRequestCommandHandler : IRequestHandler<AcceptFriendRequestCommand, Result>
    {
        private readonly IFriendshipRepository _friendshipRepository;
        private readonly IApplicationDbContext _dbContext;
        private readonly ICurrentUserService _currentUserService;
        private readonly IBusinessEventLogger? _businessLogger;
        private readonly ILogger<AcceptFriendRequestCommandHandler> _logger;

        public AcceptFriendRequestCommandHandler(
            IFriendshipRepository friendshipRepository,
            IApplicationDbContext dbContext,
            ICurrentUserService currentUserService,
            ILogger<AcceptFriendRequestCommandHandler> logger,
            IBusinessEventLogger? businessLogger = null)
        {
            _friendshipRepository = friendshipRepository;
            _dbContext = dbContext;
            _currentUserService = currentUserService;
            _logger = logger;
            _businessLogger = businessLogger;
        }

        public async Task<Result> Handle(AcceptFriendRequestCommand request, CancellationToken cancellationToken)
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
                    return Result.Failure("FORBIDDEN", "Only the addressee can accept the request");

                friendship.Accept(userId);
                _friendshipRepository.Update(friendship);
                await _dbContext.SaveChangesAsync(cancellationToken);

                _businessLogger?.LogBusinessEvent(
                    FriendRequestAccepted,
                    $"Friend request {request.FriendshipId} accepted by {userId}",
                    new
                    {
                        FriendshipId = request.FriendshipId,
                        RequesterId = friendship.RequesterId,
                        AddresseeId = friendship.AddresseeId
                    },
                    userId.ToString());

                _logger.LogInformation("Friend request {FriendshipId} accepted by {UserId}", request.FriendshipId, userId);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to accept friend request {FriendshipId}", request.FriendshipId);
                return Result.Failure("ACCEPT_FAILED", ex.Message);
            }
        }
    }
}


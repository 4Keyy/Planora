using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Services;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest
{
    public sealed class SendFriendRequestCommandHandler : IRequestHandler<SendFriendRequestCommand, Result>
    {
        private readonly IFriendshipRepository _friendshipRepository;
        private readonly IUserRepository _userRepository;
        private readonly IApplicationDbContext _dbContext;
        private readonly ICurrentUserService _currentUserService;
        private readonly IBusinessEventLogger? _businessLogger;
        private readonly ILogger<SendFriendRequestCommandHandler> _logger;

        public SendFriendRequestCommandHandler(
            IFriendshipRepository friendshipRepository,
            IUserRepository userRepository,
            IApplicationDbContext dbContext,
            ICurrentUserService currentUserService,
            ILogger<SendFriendRequestCommandHandler> logger,
            IBusinessEventLogger? businessLogger = null)
        {
            _friendshipRepository = friendshipRepository;
            _userRepository = userRepository;
            _dbContext = dbContext;
            _currentUserService = currentUserService;
            _logger = logger;
            _businessLogger = businessLogger;
        }

        public async Task<Result> Handle(SendFriendRequestCommand request, CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
                return Result.Failure("AUTH_REQUIRED", "User context is not available");

            var userId = _currentUserService.UserId.Value;

            try
            {
                var currentUser = await _userRepository.GetByIdAsync(userId, cancellationToken);
                if (currentUser == null)
                    return Result.Failure("USER_NOT_FOUND", "Current user not found");

                // Email verification is REQUIRED for adding friends
                if (!currentUser.CanAddFriends())
                {
                    return Result.Failure(
                        "EMAIL_NOT_VERIFIED",
                        "Email verification is required to add friends. Please verify your email address first.");
                }

                if (userId == request.FriendId)
                    return Result.Failure("INVALID_REQUEST", "Cannot send friend request to yourself");

                var friend = await _userRepository.GetByIdAsync(request.FriendId, cancellationToken);
                if (friend == null)
                    return Result.Failure("USER_NOT_FOUND", "Friend not found");

                var existingFriendship = await _friendshipRepository.GetFriendshipAsync(userId, request.FriendId, cancellationToken);
                if (existingFriendship != null)
                {
                    if (existingFriendship.Status == Domain.Enums.FriendshipStatus.Accepted)
                        return Result.Failure("ALREADY_FRIENDS", "Already friends with this user");
                    if (existingFriendship.Status == Domain.Enums.FriendshipStatus.Pending)
                        return Result.Failure("PENDING_REQUEST", "Friend request already pending");
                }

                var friendship = Friendship.Create(userId, request.FriendId);
                await _friendshipRepository.AddAsync(friendship, cancellationToken);
                await _dbContext.SaveChangesAsync(cancellationToken);

                _businessLogger?.LogBusinessEvent(
                    FriendRequestSent,
                    $"Friend request sent from {userId} to {request.FriendId}",
                    new { RequesterId = userId, AddresseeId = request.FriendId, Method = "Guid" },
                    userId.ToString());

                _logger.LogInformation("Friend request sent from {UserId} to {FriendId}", userId, request.FriendId);

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to send friend request from {UserId} to {FriendId}", userId, request.FriendId);
                return Result.Failure("SEND_FAILED", ex.Message);
            }
        }
    }
}


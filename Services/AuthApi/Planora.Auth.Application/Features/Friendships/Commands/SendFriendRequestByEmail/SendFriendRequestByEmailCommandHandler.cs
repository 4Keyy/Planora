using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Services;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;

public sealed class SendFriendRequestByEmailCommandHandler : IRequestHandler<SendFriendRequestByEmailCommand, Result>
{
    private readonly IFriendshipRepository _friendshipRepository;
    private readonly IUserRepository _userRepository;
    private readonly IApplicationDbContext _dbContext;
    private readonly ICurrentUserService _currentUserService;
    private readonly IBusinessEventLogger? _businessLogger;
    private readonly ILogger<SendFriendRequestByEmailCommandHandler> _logger;

    public SendFriendRequestByEmailCommandHandler(
        IFriendshipRepository friendshipRepository,
        IUserRepository userRepository,
        IApplicationDbContext dbContext,
        ICurrentUserService currentUserService,
        ILogger<SendFriendRequestByEmailCommandHandler> logger,
        IBusinessEventLogger? businessLogger = null)
    {
        _friendshipRepository = friendshipRepository;
        _userRepository = userRepository;
        _dbContext = dbContext;
        _currentUserService = currentUserService;
        _logger = logger;
        _businessLogger = businessLogger;
    }

    public async Task<Result> Handle(SendFriendRequestByEmailCommand request, CancellationToken cancellationToken)
    {
        if (!_currentUserService.UserId.HasValue)
            return Result.Failure("AUTH_REQUIRED", "User context is not available");

        var userId = _currentUserService.UserId.Value;

        try
        {
            var currentUser = await _userRepository.GetByIdAsync(userId, cancellationToken);
            if (currentUser == null)
                return Result.Failure("USER_NOT_FOUND", "Current user not found");

            if (!currentUser.CanAddFriends())
            {
                return Result.Failure(
                    "EMAIL_NOT_VERIFIED",
                    "Email verification is required to add friends. Please verify your email address first.");
            }

            Email email;
            try
            {
                email = Email.Create(request.Email);
            }
            catch
            {
                return Result.Success();
            }

            var friend = await _userRepository.GetByEmailAsync(email, cancellationToken);
            if (friend == null || friend.Id == userId)
            {
                return Result.Success();
            }

            var existingFriendship = await _friendshipRepository.GetFriendshipAsync(userId, friend.Id, cancellationToken);
            if (existingFriendship is not null
                && (existingFriendship.Status == Domain.Enums.FriendshipStatus.Accepted
                    || existingFriendship.Status == Domain.Enums.FriendshipStatus.Pending))
            {
                return Result.Success();
            }

            var friendship = Friendship.Create(userId, friend.Id);
            await _friendshipRepository.AddAsync(friendship, cancellationToken);
            await _dbContext.SaveChangesAsync(cancellationToken);

            _businessLogger?.LogBusinessEvent(
                FriendRequestSent,
                $"Friend request sent from {userId} to {friend.Id}",
                new { RequesterId = userId, AddresseeId = friend.Id, Method = "Email" },
                userId.ToString());

            _logger.LogInformation("Friend request sent from {UserId} to {FriendId} by email", userId, friend.Id);

            return Result.Success();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send email friend request from {UserId}", userId);
            return Result.Failure("SEND_FAILED", ex.Message);
        }
    }
}

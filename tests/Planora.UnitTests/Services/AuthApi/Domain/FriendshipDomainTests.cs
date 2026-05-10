using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Exceptions;
using Planora.BuildingBlocks.Domain.Exceptions;

namespace Planora.UnitTests.Services.AuthApi.Domain;

public sealed class FriendshipDomainTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Create_ShouldRequireDistinctNonEmptyParticipantsAndInitializePendingRequest()
    {
        var requesterId = Guid.NewGuid();
        var addresseeId = Guid.NewGuid();

        var friendship = Friendship.Create(requesterId, addresseeId);

        Assert.NotEqual(Guid.Empty, friendship.Id);
        Assert.Equal(requesterId, friendship.RequesterId);
        Assert.Equal(addresseeId, friendship.AddresseeId);
        Assert.Equal(FriendshipStatus.Pending, friendship.Status);
        Assert.False(friendship.IsActive);
        Assert.NotNull(friendship.RequestedAt);
        Assert.Equal(requesterId, friendship.CreatedBy);
        Assert.Throws<AuthDomainException>(() => Friendship.Create(Guid.Empty, addresseeId));
        Assert.Throws<AuthDomainException>(() => Friendship.Create(requesterId, Guid.Empty));
        Assert.Throws<AuthDomainException>(() => Friendship.Create(requesterId, requesterId));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void AcceptRejectCancelAndRemove_ShouldEnforceParticipantAndStatusRules()
    {
        var requesterId = Guid.NewGuid();
        var addresseeId = Guid.NewGuid();

        var accepted = Friendship.Create(requesterId, addresseeId);
        Assert.Throws<AuthDomainException>(() => accepted.Accept(requesterId));
        accepted.Accept(addresseeId);
        Assert.Equal(FriendshipStatus.Accepted, accepted.Status);
        Assert.True(accepted.IsActive);
        Assert.NotNull(accepted.AcceptedAt);
        Assert.Equal(addresseeId, accepted.UpdatedBy);
        Assert.Throws<AuthDomainException>(() => accepted.Accept(addresseeId));
        Assert.Throws<AuthDomainException>(() => accepted.Reject(addresseeId));
        Assert.Throws<AuthDomainException>(() => accepted.Cancel(requesterId));
        Assert.Throws<AuthDomainException>(() => accepted.Remove(Guid.NewGuid()));
        accepted.Remove(requesterId);
        Assert.Equal(FriendshipStatus.Removed, accepted.Status);
        Assert.False(accepted.IsActive);

        var rejected = Friendship.Create(requesterId, addresseeId);
        Assert.Throws<AuthDomainException>(() => rejected.Reject(requesterId));
        rejected.Reject(addresseeId);
        Assert.Equal(FriendshipStatus.Rejected, rejected.Status);
        Assert.NotNull(rejected.RejectedAt);
        Assert.Throws<AuthDomainException>(() => rejected.Remove(addresseeId));

        var cancelled = Friendship.Create(requesterId, addresseeId);
        Assert.Throws<AuthDomainException>(() => cancelled.Cancel(addresseeId));
        cancelled.Cancel(requesterId);
        Assert.Equal(FriendshipStatus.Cancelled, cancelled.Status);
        Assert.Throws<AuthDomainException>(() => cancelled.Cancel(requesterId));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void UserLockedException_ShouldExposeUnauthorizedCategoryAndOptionalLockDetail()
    {
        var lockedUntil = new DateTime(2030, 1, 2, 3, 4, 5, DateTimeKind.Utc);
        var temporary = new UserLockedException(lockedUntil);
        var permanent = new UserLockedException(null);

        Assert.Equal(ErrorCategory.Unauthorized, temporary.Category);
        Assert.Equal(ErrorCategory.Unauthorized, permanent.Category);
        Assert.Contains("2030-01-02 03:04:05 UTC", temporary.Message);
        Assert.Contains("permanently locked", permanent.Message);
        Assert.Contains("LockedUntil", temporary.ToString());
        Assert.DoesNotContain("LockedUntil", permanent.ToString());
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void UserNotFoundException_ShouldExposeNotFoundCategoryAndLookupDetails()
    {
        var userId = Guid.NewGuid();
        var byId = new UserNotFoundException(userId);
        var byEmail = new UserNotFoundException("missing@example.com");

        Assert.Equal(ErrorCategory.NotFound, byId.Category);
        Assert.Equal(ErrorCategory.NotFound, byEmail.Category);
        Assert.Contains(userId.ToString(), byId.Message);
        Assert.Contains("missing@example.com", byEmail.Message);
        Assert.Contains($"UserId={userId}", byId.ToString());
        Assert.Contains("Email=missing@example.com", byEmail.ToString());
    }
}

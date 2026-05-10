using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Friendships.Commands.AcceptFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RejectFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.RemoveFriend;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest;
using Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;
using Planora.Auth.Application.Features.Friendships.Queries.AreFriends;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendIds;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendRequests;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriends;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Enums;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Domain.ValueObjects;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Friendships;

public class FriendshipHandlerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Security")]
    public async Task SendFriendRequest_ShouldRequireVerifiedRequesterAndCreatePendingRequest()
    {
        var requester = CreateUser("requester@example.com", verifyEmail: true);
        var addressee = CreateUser("friend@example.com", verifyEmail: true);
        var fixture = new FriendshipFixture(requester.Id);
        Friendship? created = null;
        fixture.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync(requester);
        fixture.Users.Setup(x => x.GetByIdAsync(addressee.Id, It.IsAny<CancellationToken>())).ReturnsAsync(addressee);
        fixture.Friendships
            .Setup(x => x.GetFriendshipAsync(requester.Id, addressee.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Friendship?)null);
        fixture.Friendships
            .Setup(x => x.AddAsync(It.IsAny<Friendship>(), It.IsAny<CancellationToken>()))
            .Callback<Friendship, CancellationToken>((friendship, _) => created = friendship)
            .ReturnsAsync((Friendship friendship, CancellationToken _) => friendship);

        var result = await fixture.CreateSendHandler().Handle(
            new SendFriendRequestCommand(addressee.Id),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(created);
        Assert.Equal(requester.Id, created!.RequesterId);
        Assert.Equal(addressee.Id, created.AddresseeId);
        Assert.Equal(FriendshipStatus.Pending, created.Status);
        fixture.DbContext.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);

        var unverified = CreateUser("unverified@example.com", verifyEmail: false);
        var unverifiedFixture = new FriendshipFixture(unverified.Id);
        unverifiedFixture.Users.Setup(x => x.GetByIdAsync(unverified.Id, It.IsAny<CancellationToken>())).ReturnsAsync(unverified);
        var blocked = await unverifiedFixture.CreateSendHandler().Handle(
            new SendFriendRequestCommand(addressee.Id),
            CancellationToken.None);
        Assert.Equal("EMAIL_NOT_VERIFIED", blocked.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task SendFriendRequestByEmail_ShouldBeGenericAndCreateOnlyForEligibleExistingUsers()
    {
        var requester = CreateUser("requester@example.com", verifyEmail: true);
        var addressee = CreateUser("friend@example.com", verifyEmail: true);

        var missing = new FriendshipFixture(requester.Id);
        missing.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync(requester);
        missing.Users.Setup(x => x.GetByEmailAsync(Email.Create("missing@example.com"), It.IsAny<CancellationToken>()))
            .ReturnsAsync((User?)null);

        var missingResult = await missing.CreateSendByEmailHandler().Handle(
            new SendFriendRequestByEmailCommand("missing@example.com"),
            CancellationToken.None);

        Assert.True(missingResult.IsSuccess);
        missing.Friendships.Verify(x => x.AddAsync(It.IsAny<Friendship>(), It.IsAny<CancellationToken>()), Times.Never);

        var self = new FriendshipFixture(requester.Id);
        self.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync(requester);
        self.Users.Setup(x => x.GetByEmailAsync(requester.Email, It.IsAny<CancellationToken>())).ReturnsAsync(requester);

        var selfResult = await self.CreateSendByEmailHandler().Handle(
            new SendFriendRequestByEmailCommand(requester.Email.Value),
            CancellationToken.None);

        Assert.True(selfResult.IsSuccess);
        self.Friendships.Verify(x => x.AddAsync(It.IsAny<Friendship>(), It.IsAny<CancellationToken>()), Times.Never);

        var duplicate = new FriendshipFixture(requester.Id);
        duplicate.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync(requester);
        duplicate.Users.Setup(x => x.GetByEmailAsync(addressee.Email, It.IsAny<CancellationToken>())).ReturnsAsync(addressee);
        duplicate.Friendships
            .Setup(x => x.GetFriendshipAsync(requester.Id, addressee.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Friendship.Create(requester.Id, addressee.Id));

        var duplicateResult = await duplicate.CreateSendByEmailHandler().Handle(
            new SendFriendRequestByEmailCommand(addressee.Email.Value),
            CancellationToken.None);

        Assert.True(duplicateResult.IsSuccess);
        duplicate.Friendships.Verify(x => x.AddAsync(It.IsAny<Friendship>(), It.IsAny<CancellationToken>()), Times.Never);

        var createdFixture = new FriendshipFixture(requester.Id);
        Friendship? created = null;
        createdFixture.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync(requester);
        createdFixture.Users.Setup(x => x.GetByEmailAsync(addressee.Email, It.IsAny<CancellationToken>())).ReturnsAsync(addressee);
        createdFixture.Friendships
            .Setup(x => x.GetFriendshipAsync(requester.Id, addressee.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Friendship?)null);
        createdFixture.Friendships
            .Setup(x => x.AddAsync(It.IsAny<Friendship>(), It.IsAny<CancellationToken>()))
            .Callback<Friendship, CancellationToken>((friendship, _) => created = friendship)
            .ReturnsAsync((Friendship friendship, CancellationToken _) => friendship);

        var createdResult = await createdFixture.CreateSendByEmailHandler().Handle(
            new SendFriendRequestByEmailCommand("Friend@Example.com"),
            CancellationToken.None);

        Assert.True(createdResult.IsSuccess);
        Assert.NotNull(created);
        Assert.Equal(requester.Id, created!.RequesterId);
        Assert.Equal(addressee.Id, created.AddresseeId);
        Assert.Equal(FriendshipStatus.Pending, created.Status);
        createdFixture.DbContext.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [InlineData(FriendshipStatus.Accepted, "ALREADY_FRIENDS")]
    [InlineData(FriendshipStatus.Pending, "PENDING_REQUEST")]
    [Trait("TestType", "Regression")]
    public async Task SendFriendRequest_ShouldRejectSelfMissingFriendAndExistingRelationship(
        FriendshipStatus existingStatus,
        string expectedCode)
    {
        var requester = CreateUser("requester@example.com", verifyEmail: true);
        var addressee = CreateUser("friend@example.com", verifyEmail: true);
        var anonymousFixture = new FriendshipFixture(null);
        var authRequired = await anonymousFixture.CreateSendHandler().Handle(
            new SendFriendRequestCommand(addressee.Id),
            CancellationToken.None);
        Assert.Equal("AUTH_REQUIRED", authRequired.Error!.Code);

        var fixture = new FriendshipFixture(requester.Id);
        fixture.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var missingRequester = await fixture.CreateSendHandler().Handle(
            new SendFriendRequestCommand(addressee.Id),
            CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", missingRequester.Error!.Code);

        fixture.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync(requester);

        var self = await fixture.CreateSendHandler().Handle(new SendFriendRequestCommand(requester.Id), CancellationToken.None);
        Assert.Equal("INVALID_REQUEST", self.Error!.Code);

        fixture.Users.Setup(x => x.GetByIdAsync(addressee.Id, It.IsAny<CancellationToken>())).ReturnsAsync((User?)null);
        var missing = await fixture.CreateSendHandler().Handle(new SendFriendRequestCommand(addressee.Id), CancellationToken.None);
        Assert.Equal("USER_NOT_FOUND", missing.Error!.Code);

        fixture.Users.Setup(x => x.GetByIdAsync(addressee.Id, It.IsAny<CancellationToken>())).ReturnsAsync(addressee);
        var friendship = Friendship.Create(requester.Id, addressee.Id);
        if (existingStatus == FriendshipStatus.Accepted)
        {
            friendship.Accept(addressee.Id);
        }

        fixture.Friendships
            .Setup(x => x.GetFriendshipAsync(requester.Id, addressee.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(friendship);

        var existing = await fixture.CreateSendHandler().Handle(new SendFriendRequestCommand(addressee.Id), CancellationToken.None);
        Assert.Equal(expectedCode, existing.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task AcceptRejectAndRemove_ShouldEnforceActorAndPersistStateTransitions()
    {
        var requesterId = Guid.NewGuid();
        var addresseeId = Guid.NewGuid();
        var pending = Friendship.Create(requesterId, addresseeId);
        var fixture = new FriendshipFixture(addresseeId);
        fixture.Friendships.Setup(x => x.GetByIdAsync(pending.Id, It.IsAny<CancellationToken>())).ReturnsAsync(pending);

        var accepted = await fixture.CreateAcceptHandler().Handle(
            new AcceptFriendRequestCommand(pending.Id),
            CancellationToken.None);

        Assert.True(accepted.IsSuccess);
        Assert.Equal(FriendshipStatus.Accepted, pending.Status);
        fixture.Friendships.Verify(x => x.Update(pending), Times.Once);
        fixture.DbContext.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);

        var pendingForbiddenAccept = Friendship.Create(requesterId, addresseeId);
        var forbiddenAcceptFixture = new FriendshipFixture(requesterId);
        forbiddenAcceptFixture.Friendships
            .Setup(x => x.GetByIdAsync(pendingForbiddenAccept.Id, It.IsAny<CancellationToken>()))
            .ReturnsAsync(pendingForbiddenAccept);
        var forbiddenAccept = await forbiddenAcceptFixture.CreateAcceptHandler().Handle(
            new AcceptFriendRequestCommand(pendingForbiddenAccept.Id),
            CancellationToken.None);
        Assert.Equal("FORBIDDEN", forbiddenAccept.Error!.Code);

        var forbiddenFixture = new FriendshipFixture(requesterId);
        forbiddenFixture.Friendships.Setup(x => x.GetByIdAsync(pending.Id, It.IsAny<CancellationToken>())).ReturnsAsync(pending);
        var forbiddenReject = await forbiddenFixture.CreateRejectHandler().Handle(
            new RejectFriendRequestCommand(pending.Id),
            CancellationToken.None);
        Assert.Equal("FORBIDDEN", forbiddenReject.Error!.Code);

        var pendingToReject = Friendship.Create(requesterId, addresseeId);
        fixture.Friendships.Setup(x => x.GetByIdAsync(pendingToReject.Id, It.IsAny<CancellationToken>())).ReturnsAsync(pendingToReject);
        var rejected = await fixture.CreateRejectHandler().Handle(
            new RejectFriendRequestCommand(pendingToReject.Id),
            CancellationToken.None);
        Assert.True(rejected.IsSuccess);
        Assert.Equal(FriendshipStatus.Rejected, pendingToReject.Status);

        var removeFixture = new FriendshipFixture(requesterId);
        removeFixture.Friendships
            .Setup(x => x.GetFriendshipAsync(requesterId, addresseeId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(pending);
        var removed = await removeFixture.CreateRemoveHandler().Handle(
            new RemoveFriendCommand(addresseeId),
            CancellationToken.None);
        Assert.True(removed.IsSuccess);
        Assert.Equal(FriendshipStatus.Removed, pending.Status);
        removeFixture.UnitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task AcceptRejectRemove_ShouldReturnExpectedFailures()
    {
        var userId = Guid.NewGuid();
        var fixture = new FriendshipFixture(null);
        var authRequired = await fixture.CreateAcceptHandler().Handle(new AcceptFriendRequestCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("AUTH_REQUIRED", authRequired.Error!.Code);
        var rejectAuthRequired = await fixture.CreateRejectHandler().Handle(new RejectFriendRequestCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("AUTH_REQUIRED", rejectAuthRequired.Error!.Code);
        var removeAuthRequired = await fixture.CreateRemoveHandler().Handle(new RemoveFriendCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("AUTH_REQUIRED", removeAuthRequired.Error!.Code);
        var friendsAuthRequired = await fixture.CreateGetFriendsHandler().Handle(new GetFriendsQuery(), CancellationToken.None);
        Assert.Equal("AUTH_REQUIRED", friendsAuthRequired.Error!.Code);
        var requestsAuthRequired = await fixture.CreateGetFriendRequestsHandler().Handle(new GetFriendRequestsQuery(), CancellationToken.None);
        Assert.Equal("AUTH_REQUIRED", requestsAuthRequired.Error!.Code);

        fixture = new FriendshipFixture(userId);
        fixture.Friendships.Setup(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>())).ReturnsAsync((Friendship?)null);
        var missing = await fixture.CreateAcceptHandler().Handle(new AcceptFriendRequestCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("FRIENDSHIP_NOT_FOUND", missing.Error!.Code);
        var rejectMissing = await fixture.CreateRejectHandler().Handle(new RejectFriendRequestCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("FRIENDSHIP_NOT_FOUND", rejectMissing.Error!.Code);

        var pending = Friendship.Create(Guid.NewGuid(), Guid.NewGuid());
        fixture.Friendships.Setup(x => x.GetFriendshipAsync(userId, pending.AddresseeId, It.IsAny<CancellationToken>()))
            .ReturnsAsync((Friendship?)null);
        var removeMissing = await fixture.CreateRemoveHandler().Handle(new RemoveFriendCommand(pending.AddresseeId), CancellationToken.None);
        Assert.Equal("FRIENDSHIP_NOT_FOUND", removeMissing.Error!.Code);

        fixture.Friendships.Setup(x => x.GetFriendshipAsync(userId, pending.AddresseeId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(pending);
        var notFriends = await fixture.CreateRemoveHandler().Handle(new RemoveFriendCommand(pending.AddresseeId), CancellationToken.None);
        Assert.Equal("NOT_FRIENDS", notFriends.Error!.Code);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetFriends_ShouldMapAcceptedFriendshipsWithPagination()
    {
        var userId = Guid.NewGuid();
        var friend1 = CreateUser("friend1@example.com", verifyEmail: true);
        var friend2 = CreateUser("friend2@example.com", verifyEmail: true);
        var accepted1 = Friendship.Create(userId, friend1.Id);
        accepted1.Accept(friend1.Id);
        var accepted2 = Friendship.Create(friend2.Id, userId);
        accepted2.Accept(userId);
        var fixture = new FriendshipFixture(userId);
        fixture.Friendships
            .Setup(x => x.GetFriendshipsForUserAsync(userId, FriendshipStatus.Accepted, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { accepted1, accepted2 });
        fixture.Users.Setup(x => x.GetByIdAsync(friend1.Id, It.IsAny<CancellationToken>())).ReturnsAsync(friend1);
        fixture.Users.Setup(x => x.GetByIdAsync(friend2.Id, It.IsAny<CancellationToken>())).ReturnsAsync(friend2);

        var result = await fixture.CreateGetFriendsHandler().Handle(
            new GetFriendsQuery(PageNumber: 2, PageSize: 1),
            CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value!.TotalCount);
        var dto = Assert.Single(result.Value.Items);
        Assert.Equal(friend2.Id, dto.Id);
        Assert.Equal("friend2@example.com", dto.Email);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetFriendRequests_ShouldMapIncomingAndOutgoingRequests()
    {
        var userId = Guid.NewGuid();
        var requester = CreateUser("requester@example.com", verifyEmail: true);
        var addressee = CreateUser("addressee@example.com", verifyEmail: true);
        var incoming = Friendship.Create(requester.Id, userId);
        var outgoing = Friendship.Create(userId, addressee.Id);
        var fixture = new FriendshipFixture(userId);
        fixture.Friendships
            .Setup(x => x.GetFriendshipsForUserAsync(userId, FriendshipStatus.Pending, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { incoming, outgoing });
        fixture.Users.Setup(x => x.GetByIdAsync(requester.Id, It.IsAny<CancellationToken>())).ReturnsAsync(requester);
        fixture.Users.Setup(x => x.GetByIdAsync(addressee.Id, It.IsAny<CancellationToken>())).ReturnsAsync(addressee);

        var incomingResult = await fixture.CreateGetFriendRequestsHandler().Handle(
            new GetFriendRequestsQuery(Incoming: true),
            CancellationToken.None);
        var outgoingResult = await fixture.CreateGetFriendRequestsHandler().Handle(
            new GetFriendRequestsQuery(Incoming: false),
            CancellationToken.None);

        Assert.Equal(requester.Id, Assert.Single(incomingResult.Value!).UserId);
        Assert.Equal(addressee.Id, Assert.Single(outgoingResult.Value!).UserId);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public async Task GetFriendQueries_ShouldReturnIdsAndPairStatus()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var strangerId = Guid.NewGuid();
        var friendship = Friendship.Create(userId, friendId);
        friendship.Accept(friendId);
        var repository = new Mock<IFriendshipRepository>();
        repository
            .Setup(x => x.GetFriendshipsForUserAsync(userId, FriendshipStatus.Accepted, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { friendship });

        var ids = await new GetFriendIdsQueryHandler(repository.Object).Handle(
            new GetFriendIdsQuery(userId),
            CancellationToken.None);
        var areFriends = await new AreFriendsQueryHandler(repository.Object).Handle(
            new AreFriendsQuery(userId, friendId),
            CancellationToken.None);
        var areNotFriends = await new AreFriendsQueryHandler(repository.Object).Handle(
            new AreFriendsQuery(userId, strangerId),
            CancellationToken.None);

        Assert.Equal(friendId, Assert.Single(ids.Value!));
        Assert.True(areFriends.Value);
        Assert.False(areNotFriends.Value);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task FriendshipHandlers_ShouldConvertRepositoryExceptionsToFailureResults()
    {
        var userId = Guid.NewGuid();
        var fixture = new FriendshipFixture(userId);
        fixture.Friendships
            .Setup(x => x.GetFriendshipsForUserAsync(userId, FriendshipStatus.Accepted, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database down"));
        var friends = await fixture.CreateGetFriendsHandler().Handle(new GetFriendsQuery(), CancellationToken.None);
        Assert.Equal("QUERY_FAILED", friends.Error!.Code);

        fixture.Friendships
            .Setup(x => x.GetFriendshipsForUserAsync(userId, FriendshipStatus.Pending, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database down"));
        var requests = await fixture.CreateGetFriendRequestsHandler().Handle(new GetFriendRequestsQuery(), CancellationToken.None);
        Assert.Equal("QUERY_FAILED", requests.Error!.Code);

        var requester = CreateUser("requester@example.com", verifyEmail: true);
        fixture.Users.Setup(x => x.GetByIdAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(requester);
        fixture.Users.Setup(x => x.GetByIdAsync(It.Is<Guid>(id => id != userId), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("user repo down"));
        var send = await fixture.CreateSendHandler().Handle(new SendFriendRequestCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("SEND_FAILED", send.Error!.Code);

        fixture.Friendships
            .Setup(x => x.GetByIdAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("friendship repo down"));
        var accept = await fixture.CreateAcceptHandler().Handle(new AcceptFriendRequestCommand(Guid.NewGuid()), CancellationToken.None);
        var reject = await fixture.CreateRejectHandler().Handle(new RejectFriendRequestCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("ACCEPT_FAILED", accept.Error!.Code);
        Assert.Equal("REJECT_FAILED", reject.Error!.Code);

        fixture.Friendships
            .Setup(x => x.GetFriendshipAsync(userId, It.IsAny<Guid>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("friendship lookup down"));
        var remove = await fixture.CreateRemoveHandler().Handle(new RemoveFriendCommand(Guid.NewGuid()), CancellationToken.None);
        Assert.Equal("REMOVE_FAILED", remove.Error!.Code);
    }

    private static User CreateUser(string email, bool verifyEmail)
    {
        var user = User.Create(Email.Create(email), "hash", "Test", "User");
        if (verifyEmail)
        {
            user.VerifyEmail();
        }

        return user;
    }

    private sealed class FriendshipFixture
    {
        public Mock<IFriendshipRepository> Friendships { get; } = new();
        public Mock<IUserRepository> Users { get; } = new();
        public Mock<IApplicationDbContext> DbContext { get; } = new();
        public Mock<IAuthUnitOfWork> UnitOfWork { get; } = new();
        public Mock<ICurrentUserService> CurrentUser { get; } = new();

        public FriendshipFixture(Guid? userId)
        {
            CurrentUser.SetupGet(x => x.UserId).Returns(userId);
            DbContext.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
            UnitOfWork.Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>())).ReturnsAsync(1);
        }

        public SendFriendRequestCommandHandler CreateSendHandler()
            => new(
                Friendships.Object,
                Users.Object,
                DbContext.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<SendFriendRequestCommandHandler>>());

        public SendFriendRequestByEmailCommandHandler CreateSendByEmailHandler()
            => new(
                Friendships.Object,
                Users.Object,
                DbContext.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<SendFriendRequestByEmailCommandHandler>>());

        public AcceptFriendRequestCommandHandler CreateAcceptHandler()
            => new(
                Friendships.Object,
                DbContext.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<AcceptFriendRequestCommandHandler>>());

        public RejectFriendRequestCommandHandler CreateRejectHandler()
            => new(
                Friendships.Object,
                DbContext.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<RejectFriendRequestCommandHandler>>());

        public RemoveFriendCommandHandler CreateRemoveHandler()
            => new(
                Friendships.Object,
                UnitOfWork.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<RemoveFriendCommandHandler>>());

        public GetFriendsQueryHandler CreateGetFriendsHandler()
            => new(
                Friendships.Object,
                Users.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<GetFriendsQueryHandler>>());

        public GetFriendRequestsQueryHandler CreateGetFriendRequestsHandler()
            => new(
                Friendships.Object,
                Users.Object,
                CurrentUser.Object,
                Mock.Of<ILogger<GetFriendRequestsQueryHandler>>());
    }
}

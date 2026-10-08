using Google.Protobuf.Reflection;
using Grpc.Core;
using MediatR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Moq.Protected;
using Planora.Auth.Api.Grpc;
using Planora.Auth.Application.Features.Friendships.Queries.GetFriendships;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Auth.Infrastructure.Persistence.Repositories;
using Planora.BuildingBlocks.Application.Models;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Infrastructure.Grpc;
using Planora.GrpcContracts;
using Planora.UnitTests.BuildingBlocks.Retention.Postgres;

namespace Planora.UnitTests.Services.AuthApi.Grpc;

public sealed class AuthFriendshipsSnapshotContractTests
{
    [Fact]
    public void Contract_IsAdditiveAndTimestampAbsenceIsPreserved()
    {
        var rpc = AuthReflection.Descriptor.Services.Single(s => s.Name == "AuthService")
            .Methods.Single(m => m.Name == "GetFriendships");
        Assert.Equal("GetFriendshipsRequest", rpc.InputType.Name);
        Assert.Equal("GetFriendshipsResponse", rpc.OutputType.Name);
        var field = FriendshipSummary.Descriptor.FindFieldByName("accepted_at");
        Assert.Equal(FieldType.Message, field.FieldType);
        Assert.Equal("google.protobuf.Timestamp", field.MessageType.FullName);
        Assert.Null(new FriendshipSummary().AcceptedAt);
        Assert.Equal(1, GetFriendIdsResponse.Descriptor.FindFieldByName("friend_ids").FieldNumber);
    }

    [Fact]
    public async Task Query_ReturnsOnlyCurrentlyAcceptedFriendsInBothDirectionsWithTheirActualTimestamps()
    {
        await using var db = new AuthDbContext(new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options, Mock.Of<IDomainEventDispatcher>());
        var owner = Guid.NewGuid();
        var oldFriend = Guid.NewGuid();
        var legacyFriend = Guid.NewGuid();
        var acceptedAt = new DateTime(2026, 1, 2, 3, 4, 5, DateTimeKind.Utc);
        var old = Friendship.Create(owner, oldFriend);
        old.Accept(oldFriend);
        RetentionTestKit.Set(old, nameof(Friendship.AcceptedAt), acceptedAt);
        var legacy = Friendship.Create(legacyFriend, owner);
        legacy.Accept(owner);
        RetentionTestKit.Set(legacy, nameof(Friendship.AcceptedAt), null);
        var pending = Friendship.Create(owner, Guid.NewGuid());
        var removed = Friendship.Create(owner, Guid.NewGuid());
        removed.Accept(removed.AddresseeId);
        removed.Remove(owner);
        foreach (var id in new[] { old, legacy, pending, removed }
            .SelectMany(f => new[] { f.RequesterId, f.AddresseeId }).Distinct())
        {
            var user = User.Create(Planora.Auth.Domain.ValueObjects.Email.Create($"{id:N}@example.test"),
                "hash", "Snapshot", "Participant");
            RetentionTestKit.Set(user, nameof(User.Id), id);
            db.Users.Add(user);
        }
        db.Friendships.AddRange(old, legacy, pending, removed);
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var result = await new GetFriendshipsQueryHandler(new FriendshipRepository(db))
            .Handle(new GetFriendshipsQuery(owner), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Count);
        Assert.Equal(acceptedAt, result.Value.Single(f => f.FriendId == oldFriend).AcceptedAt);
        Assert.Null(result.Value.Single(f => f.FriendId == legacyFriend).AcceptedAt);
        Assert.Empty(db.ChangeTracker.Entries());
    }

    [Fact]
    public async Task Rpc_PreservesUtcAndNullAcceptanceTimeAndPassesCancellation()
    {
        var owner = Guid.NewGuid();
        var accepted = Guid.NewGuid();
        var legacy = Guid.NewGuid();
        var time = new DateTime(2026, 3, 1, 12, 30, 0, DateTimeKind.Utc).AddTicks(1234);
        using var cancellation = new CancellationTokenSource();
        var context = new Mock<ServerCallContext>();
        context.Protected().Setup<CancellationToken>("CancellationTokenCore").Returns(cancellation.Token);
        var mediator = new Mock<IMediator>();
        IReadOnlyList<FriendshipInfoDto> friends =
            [new(accepted, time), new(legacy, null)];
        mediator.Setup(m => m.Send(It.Is<GetFriendshipsQuery>(q => q.UserId == owner), cancellation.Token))
            .ReturnsAsync(Result.Success(friends));
        var service = new AuthGrpcService(mediator.Object, NullLogger<AuthGrpcService>.Instance);

        var response = await service.GetFriendships(new GetFriendshipsRequest { UserId = owner.ToString() }, context.Object);

        Assert.Equal(time, response.Friendships.Single(f => f.FriendId == accepted.ToString()).AcceptedAt.ToDateTime());
        Assert.Null(response.Friendships.Single(f => f.FriendId == legacy.ToString()).AcceptedAt);
        mediator.VerifyAll();
    }

    [Theory]
    [InlineData("not-a-guid")]
    [InlineData("00000000-0000-0000-0000-000000000000")]
    public async Task Rpc_RejectsMalformedOwner(string id)
    {
        var mediator = new Mock<IMediator>();
        var service = new AuthGrpcService(mediator.Object, NullLogger<AuthGrpcService>.Instance);
        var error = await Assert.ThrowsAsync<RpcException>(() =>
            service.GetFriendships(new GetFriendshipsRequest { UserId = id }, Mock.Of<ServerCallContext>()));
        Assert.Equal(StatusCode.InvalidArgument, error.StatusCode);
        mediator.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task Rpc_RemainsBehindTheServiceKeyInterceptor()
    {
        var mediator = new Mock<IMediator>();
        var service = new AuthGrpcService(mediator.Object, NullLogger<AuthGrpcService>.Instance);
        var context = new Mock<ServerCallContext>();
        context.Protected().Setup<Metadata>("RequestHeadersCore").Returns(new Metadata());
        context.Protected().Setup<string>("MethodCore").Returns("/auth.AuthService/GetFriendships");
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(
            new Dictionary<string, string?> { ["GrpcSettings:ServiceKey"] = Guid.NewGuid().ToString("N") }).Build();
        var interceptor = new ServiceKeyServerInterceptor(configuration, NullLogger<ServiceKeyServerInterceptor>.Instance);

        var error = await Assert.ThrowsAsync<RpcException>(() =>
            interceptor.UnaryServerHandler(new GetFriendshipsRequest { UserId = Guid.NewGuid().ToString() },
                context.Object, service.GetFriendships));

        Assert.Equal(StatusCode.Unauthenticated, error.StatusCode);
        mediator.VerifyNoOtherCalls();
    }
}

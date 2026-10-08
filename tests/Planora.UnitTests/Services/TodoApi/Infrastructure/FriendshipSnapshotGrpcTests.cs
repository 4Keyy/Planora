using Google.Protobuf.WellKnownTypes;
using Grpc.Core;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.GrpcContracts;
using Planora.Todo.Application.Exceptions;
using Planora.Todo.Application.Services;
using Planora.Todo.Infrastructure.Services;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class FriendshipSnapshotGrpcTests
{
    [Fact]
    public async Task Client_MapsEveryFriendAndNullableUtcAcceptanceTimeAndBoundsTheCall()
    {
        var owner = Guid.NewGuid();
        var accepted = Guid.NewGuid();
        var legacy = Guid.NewGuid();
        var when = new DateTime(2025, 4, 3, 2, 1, 0, DateTimeKind.Utc);
        using var cancellation = new CancellationTokenSource();
        CallOptions captured = default;
        var service = Client((request, options) =>
        {
            Assert.Equal(owner.ToString(), request.UserId);
            captured = options;
            return Response(new() { FriendId = accepted.ToString(), AcceptedAt = Timestamp.FromDateTime(when) },
                new() { FriendId = legacy.ToString() });
        });

        var result = await service.GetFriendshipsAsync(owner, cancellation.Token);

        Assert.Equal(when, result.Single(f => f.FriendId == accepted).AcceptedAt);
        Assert.Equal(DateTimeKind.Utc, result.Single(f => f.FriendId == accepted).AcceptedAt!.Value.Kind);
        Assert.Null(result.Single(f => f.FriendId == legacy).AcceptedAt);
        Assert.Equal(cancellation.Token, captured.CancellationToken);
        Assert.NotNull(captured.Deadline);
    }

    [Theory]
    [InlineData("id")]
    [InlineData("empty")]
    [InlineData("owner")]
    [InlineData("seconds")]
    [InlineData("nanos")]
    [InlineData("precision")]
    [InlineData("duplicate")]
    public async Task Client_FailsTheWholeSnapshotOnMalformedRemoteEntries(string invalid)
    {
        var owner = Guid.NewGuid();
        var friend = Guid.NewGuid();
        var valid = new FriendshipSummary { FriendId = friend.ToString() };
        var bad = new FriendshipSummary { FriendId = Guid.NewGuid().ToString() };
        switch (invalid)
        {
            case "id": bad.FriendId = "invalid"; break;
            case "empty": bad.FriendId = Guid.Empty.ToString(); break;
            case "owner": bad.FriendId = owner.ToString(); break;
            case "seconds": bad.AcceptedAt = new Timestamp { Seconds = long.MaxValue }; break;
            case "nanos": bad.AcceptedAt = new Timestamp { Nanos = -1 }; break;
            case "precision": bad.AcceptedAt = new Timestamp { Nanos = 1 }; break;
            case "duplicate":
                bad.FriendId = friend.ToString();
                bad.AcceptedAt = Timestamp.FromDateTime(DateTime.UtcNow);
                break;
        }

        await Assert.ThrowsAsync<ExternalServiceUnavailableException>(() =>
            Client((_, _) => Response(valid, bad)).GetFriendshipsAsync(owner));
    }

    [Theory]
    [InlineData(StatusCode.Unavailable)]
    [InlineData(StatusCode.DeadlineExceeded)]
    [InlineData(StatusCode.Internal)]
    public async Task Client_FailsClosedWhenAuthIsUnavailable(StatusCode status)
    {
        await Assert.ThrowsAsync<ExternalServiceUnavailableException>(() =>
            Client((_, _) => throw new RpcException(new Status(status, "test unavailable")))
                .GetFriendshipsAsync(Guid.NewGuid()));
    }

    [Fact]
    public async Task Client_PropagatesCancellation()
    {
        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            Client((_, _) => throw new OperationCanceledException()).GetFriendshipsAsync(Guid.NewGuid()));
    }

    [Fact]
    public async Task Decorator_SnapshotReadsBypassTheFriendIdsCacheAndAlwaysSeeFreshFriendships()
    {
        var owner = Guid.NewGuid();
        var staleFriend = Guid.NewGuid();
        var currentFriend = Guid.NewGuid();
        using var cache = new MemoryCache(new MemoryCacheOptions());
        var inner = new Mock<IFriendshipService>();
        inner.Setup(x => x.GetFriendIdsAsync(owner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { staleFriend });
        inner.SetupSequence(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { new FriendshipInfo(currentFriend, null) })
            .ReturnsAsync(Array.Empty<FriendshipInfo>());
        var decorated = new CachingFriendshipService(inner.Object, cache, NullLogger<CachingFriendshipService>.Instance);
        await decorated.GetFriendIdsAsync(owner);

        var first = await decorated.GetFriendshipsAsync(owner);
        var second = await decorated.GetFriendshipsAsync(owner);

        Assert.Equal(currentFriend, Assert.Single(first).FriendId);
        Assert.Empty(second);
        inner.Verify(x => x.GetFriendshipsAsync(owner, It.IsAny<CancellationToken>()), Times.Exactly(2));
    }

    private static GetFriendshipsResponse Response(params FriendshipSummary[] friends)
    {
        var response = new GetFriendshipsResponse();
        response.Friendships.AddRange(friends);
        return response;
    }

    private static FriendshipGrpcService Client(Func<GetFriendshipsRequest, CallOptions, GetFriendshipsResponse> handler)
        => new(new AuthService.AuthServiceClient(new SnapshotInvoker(handler)), NullLogger<FriendshipGrpcService>.Instance);

    private sealed class SnapshotInvoker(Func<GetFriendshipsRequest, CallOptions, GetFriendshipsResponse> handler) : CallInvoker
    {
        public override AsyncUnaryCall<TResponse> AsyncUnaryCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options, TRequest request)
        {
            Task<TResponse> response;
            try { response = Task.FromResult((TResponse)(object)handler((GetFriendshipsRequest)(object)request!, options)); }
            catch (Exception error) { response = Task.FromException<TResponse>(error); }
            return new(response, Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
        }

        public override TResponse BlockingUnaryCall<TRequest, TResponse>(Method<TRequest, TResponse> method, string? host,
            CallOptions options, TRequest request) => throw new NotSupportedException();
        public override AsyncClientStreamingCall<TRequest, TResponse> AsyncClientStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options) => throw new NotSupportedException();
        public override AsyncServerStreamingCall<TResponse> AsyncServerStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options, TRequest request) => throw new NotSupportedException();
        public override AsyncDuplexStreamingCall<TRequest, TResponse> AsyncDuplexStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options) => throw new NotSupportedException();
    }
}

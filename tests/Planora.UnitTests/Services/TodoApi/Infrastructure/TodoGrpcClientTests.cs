using Grpc.Core;
using Grpc.Core.Testing;
using Planora.GrpcContracts;
using Planora.Todo.Application.Exceptions;
using Planora.Todo.Infrastructure.Grpc;
using Planora.Todo.Infrastructure.Services;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public class TodoGrpcClientTests
{
    [Fact]
    public async Task CategoryGrpcClient_ShouldMapValidResponseAndNormalizeEmptyOptionalFields()
    {
        var categoryId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var client = CreateCategoryClient(_ => new GetCategoryByIdResponse
        {
            Category = new CategoryModel
            {
                Id = categoryId.ToString(),
                UserId = userId.ToString(),
                Name = "Work",
                Color = "",
                Icon = "briefcase"
            }
        });

        var info = await client.GetCategoryInfoAsync(categoryId, userId, CancellationToken.None);

        Assert.NotNull(info);
        Assert.Equal(categoryId, info!.Id);
        Assert.Equal(userId, info.UserId);
        Assert.Equal("Work", info.Name);
        Assert.Null(info.Color);
        Assert.Equal("briefcase", info.Icon);
    }

    [Fact]
    public async Task CategoryGrpcClient_ShouldReturnNullForEmptyInvalidMismatchedAndForbiddenResponses()
    {
        var categoryId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        var empty = await CreateCategoryClient(_ => new GetCategoryByIdResponse())
            .GetCategoryInfoAsync(categoryId, userId, CancellationToken.None);
        Assert.Null(empty);

        var invalid = await CreateCategoryClient(_ => new GetCategoryByIdResponse
        {
            Category = new CategoryModel { Id = "not-a-guid", UserId = userId.ToString(), Name = "Broken" }
        }).GetCategoryInfoAsync(categoryId, userId, CancellationToken.None);
        Assert.Null(invalid);

        var mismatchedUser = await CreateCategoryClient(_ => new GetCategoryByIdResponse
        {
            Category = new CategoryModel
            {
                Id = categoryId.ToString(),
                UserId = Guid.NewGuid().ToString(),
                Name = "Foreign"
            }
        }).GetCategoryInfoAsync(categoryId, userId, CancellationToken.None);
        Assert.Null(mismatchedUser);

        var forbidden = await CreateCategoryClient(_ => new RpcException(new Status(StatusCode.PermissionDenied, "denied")))
            .GetCategoryInfoAsync(categoryId, userId, CancellationToken.None);
        Assert.Null(forbidden);

        var notFound = await CreateCategoryClient(_ => new RpcException(new Status(StatusCode.NotFound, "missing")))
            .GetCategoryInfoAsync(categoryId, userId, CancellationToken.None);
        Assert.Null(notFound);
    }

    [Fact]
    public async Task CategoryGrpcClient_ShouldThrowForUnavailableCancelledAndUnexpectedFailures()
    {
        var categoryId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        await Assert.ThrowsAsync<ExternalServiceUnavailableException>(() =>
            CreateCategoryClient(_ => new RpcException(new Status(StatusCode.Unavailable, "down")))
                .GetCategoryInfoAsync(categoryId, userId, CancellationToken.None));

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            CreateCategoryClient(_ => new OperationCanceledException("cancelled"))
                .GetCategoryInfoAsync(categoryId, userId, CancellationToken.None));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            CreateCategoryClient(_ => new InvalidOperationException("unexpected"))
                .GetCategoryInfoAsync(categoryId, userId, CancellationToken.None));
    }

    [Fact]
    public async Task FriendshipGrpcService_ShouldReturnDistinctValidFriendIdsAndFriendshipStatus()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var service = CreateFriendshipService(request =>
        {
            if (request is GetFriendIdsRequest)
            {
                var response = new GetFriendIdsResponse();
                response.FriendIds.Add(friendId.ToString());
                response.FriendIds.Add("not-a-guid");
                response.FriendIds.Add(friendId.ToString());
                return response;
            }

            return new AreFriendsResponse { AreFriends = true };
        });

        var friendIds = await service.GetFriendIdsAsync(userId, CancellationToken.None);
        var areFriends = await service.AreFriendsAsync(userId, friendId, CancellationToken.None);

        Assert.Single(friendIds);
        Assert.Equal(friendId, friendIds[0]);
        Assert.True(areFriends);
    }

    [Fact]
    public async Task FriendshipGrpcService_ShouldFailClosedWhenAuthGrpcIsUnavailableOrUnexpectedlyFails()
    {
        var userId = Guid.NewGuid();
        var friendId = Guid.NewGuid();

        await Assert.ThrowsAsync<ExternalServiceUnavailableException>(() =>
            CreateFriendshipService(_ => new RpcException(new Status(StatusCode.DeadlineExceeded, "timeout")))
                .GetFriendIdsAsync(userId, CancellationToken.None));

        await Assert.ThrowsAsync<ExternalServiceUnavailableException>(() =>
            CreateFriendshipService(_ => new InvalidOperationException("broken channel"))
                .GetFriendIdsAsync(userId, CancellationToken.None));

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            CreateFriendshipService(_ => new OperationCanceledException("cancelled"))
                .GetFriendIdsAsync(userId, CancellationToken.None));

        await Assert.ThrowsAsync<ExternalServiceUnavailableException>(() =>
            CreateFriendshipService(_ => new RpcException(new Status(StatusCode.Internal, "internal")))
                .AreFriendsAsync(userId, friendId, CancellationToken.None));

        await Assert.ThrowsAsync<ExternalServiceUnavailableException>(() =>
            CreateFriendshipService(_ => new InvalidOperationException("broken channel"))
                .AreFriendsAsync(userId, friendId, CancellationToken.None));

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            CreateFriendshipService(_ => new OperationCanceledException("cancelled"))
                .AreFriendsAsync(userId, friendId, CancellationToken.None));
    }

    [Fact]
    public void GrpcWrappers_ShouldRejectNullConstructorDependencies()
    {
        Assert.Throws<ArgumentNullException>(() =>
            new CategoryGrpcClient(null!, Mock.Of<ILogger<CategoryGrpcClient>>()));
        Assert.Throws<ArgumentNullException>(() =>
            new CategoryGrpcClient(new CategoryService.CategoryServiceClient(new UnaryCallInvoker(_ => new GetCategoryByIdResponse())), null!));
        Assert.Throws<ArgumentNullException>(() =>
            new FriendshipGrpcService(null!, Mock.Of<ILogger<FriendshipGrpcService>>()));
        Assert.Throws<ArgumentNullException>(() =>
            new FriendshipGrpcService(new AuthService.AuthServiceClient(new UnaryCallInvoker(_ => new GetFriendIdsResponse())), null!));
    }

    private static CategoryGrpcClient CreateCategoryClient(Func<object, object> handler)
        => new(
            new CategoryService.CategoryServiceClient(new UnaryCallInvoker(handler)),
            Mock.Of<ILogger<CategoryGrpcClient>>());

    private static FriendshipGrpcService CreateFriendshipService(Func<object, object> handler)
        => new(
            new AuthService.AuthServiceClient(new UnaryCallInvoker(handler)),
            Mock.Of<ILogger<FriendshipGrpcService>>());

    private sealed class UnaryCallInvoker(Func<object, object> handler) : CallInvoker
    {
        public override AsyncUnaryCall<TResponse> AsyncUnaryCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method,
            string? host,
            CallOptions options,
            TRequest request)
        {
            var result = handler(request!);
            var task = result switch
            {
                TResponse response => Task.FromResult(response),
                Exception exception => Task.FromException<TResponse>(exception),
                Task<TResponse> responseTask => responseTask,
                _ => Task.FromException<TResponse>(new InvalidOperationException("Unsupported fake gRPC response"))
            };

            return TestCalls.AsyncUnaryCall(
                task,
                Task.FromResult(new Metadata()),
                () => Status.DefaultSuccess,
                () => new Metadata(),
                () => { });
        }

        public override TResponse BlockingUnaryCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method,
            string? host,
            CallOptions options,
            TRequest request)
            => throw new NotSupportedException();

        public override AsyncClientStreamingCall<TRequest, TResponse> AsyncClientStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method,
            string? host,
            CallOptions options)
            => throw new NotSupportedException();

        public override AsyncServerStreamingCall<TResponse> AsyncServerStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method,
            string? host,
            CallOptions options,
            TRequest request)
            => throw new NotSupportedException();

        public override AsyncDuplexStreamingCall<TRequest, TResponse> AsyncDuplexStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method,
            string? host,
            CallOptions options)
            => throw new NotSupportedException();
    }
}

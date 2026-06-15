using Grpc.Core;
using Microsoft.Extensions.Logging;
using Moq;
using Planora.GrpcContracts;
using Planora.Realtime.Infrastructure.Grpc;

namespace Planora.UnitTests.Services.RealtimeApi.Grpc;

/// <summary>
/// The branch authorizer gates who may join a task's live-sync room. It delegates to TodoApi's
/// CheckTaskCommentAccess and MUST fail closed — an unreachable Todo, a malformed id, or a denied
/// check all resolve to "no access", so a client can never eavesdrop on a branch it may not read.
/// </summary>
public sealed class TaskBranchAuthorizerTests
{
    private static TaskBranchAuthorizer Create(Func<object, object> handler) =>
        new(new TodoService.TodoServiceClient(new UnaryInvoker(handler)),
            Mock.Of<ILogger<TaskBranchAuthorizer>>());

    [Fact]
    [Trait("TestType", "Security")]
    public async Task ExistsAndHasAccess_ReturnsTrue()
    {
        var auth = Create(_ => new CheckTaskCommentAccessResponse { Exists = true, HasAccess = true });

        Assert.True(await auth.CanAccessBranchAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task NoAccessOrMissingTask_ReturnsFalse()
    {
        var denied = Create(_ => new CheckTaskCommentAccessResponse { Exists = true, HasAccess = false });
        Assert.False(await denied.CanAccessBranchAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None));

        var missing = Create(_ => new CheckTaskCommentAccessResponse { Exists = false, HasAccess = false });
        Assert.False(await missing.CanAccessBranchAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None));
    }

    [Theory]
    [Trait("TestType", "Security")]
    [InlineData(StatusCode.Unavailable)]
    [InlineData(StatusCode.DeadlineExceeded)]
    [InlineData(StatusCode.Internal)]
    public async Task TodoGrpcFailure_FailsClosed_ReturnsFalseWithoutThrowing(StatusCode code)
    {
        var auth = Create(_ => new RpcException(new Status(code, "todo down")));

        Assert.False(await auth.CanAccessBranchAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task EmptyIds_ReturnFalse_WithoutCallingTodo()
    {
        var called = false;
        var auth = Create(_ => { called = true; return new CheckTaskCommentAccessResponse { Exists = true, HasAccess = true }; });

        Assert.False(await auth.CanAccessBranchAsync(Guid.Empty, Guid.NewGuid(), CancellationToken.None));
        Assert.False(await auth.CanAccessBranchAsync(Guid.NewGuid(), Guid.Empty, CancellationToken.None));
        Assert.False(called);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    public async Task Cancellation_Propagates()
    {
        var auth = Create(_ => new OperationCanceledException());

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            auth.CanAccessBranchAsync(Guid.NewGuid(), Guid.NewGuid(), CancellationToken.None));
    }

    /// <summary>Minimal CallInvoker that runs a handler and shapes the result into an AsyncUnaryCall.</summary>
    private sealed class UnaryInvoker(Func<object, object> handler) : CallInvoker
    {
        public override AsyncUnaryCall<TResponse> AsyncUnaryCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options, TRequest request)
        {
            var result = handler(request!);
            var task = result switch
            {
                TResponse response => Task.FromResult(response),
                Exception exception => Task.FromException<TResponse>(exception),
                _ => Task.FromException<TResponse>(new InvalidOperationException("Unsupported fake gRPC response"))
            };
            return new AsyncUnaryCall<TResponse>(
                task, Task.FromResult(new Metadata()), () => Status.DefaultSuccess, () => new Metadata(), () => { });
        }

        public override TResponse BlockingUnaryCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options, TRequest request)
            => throw new NotSupportedException();

        public override AsyncClientStreamingCall<TRequest, TResponse> AsyncClientStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options)
            => throw new NotSupportedException();

        public override AsyncServerStreamingCall<TResponse> AsyncServerStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options, TRequest request)
            => throw new NotSupportedException();

        public override AsyncDuplexStreamingCall<TRequest, TResponse> AsyncDuplexStreamingCall<TRequest, TResponse>(
            Method<TRequest, TResponse> method, string? host, CallOptions options)
            => throw new NotSupportedException();
    }
}

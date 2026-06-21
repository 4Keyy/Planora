using Grpc.Core;
using Microsoft.Extensions.Logging;
using Moq;
using Planora.GrpcContracts;
using Planora.Messaging.Api.Grpc;
using Planora.UnitTests.Shared;

namespace Planora.UnitTests.Services.MessagingApi.Grpc;

public class MessagingGrpcServiceTests
{
    [Fact]
    public async Task SendMessage_ShouldBeRefusedOverGrpc()
    {
        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            CreateService().SendMessage(
                new SendMessageRequest
                {
                    SenderId = Guid.NewGuid().ToString(),
                    ReceiverId = Guid.NewGuid().ToString(),
                    Content = "spoof attempt"
                },
                CreateContext()));

        Assert.Equal(StatusCode.PermissionDenied, ex.StatusCode);
    }

    [Fact]
    public async Task GetMessages_ShouldBeRefusedOverGrpc()
    {
        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            CreateService().GetMessages(
                new GetMessagesRequest
                {
                    UserId = Guid.NewGuid().ToString(),
                    OtherUserId = Guid.NewGuid().ToString(),
                    Page = 1,
                    PageSize = 20
                },
                CreateContext()));

        Assert.Equal(StatusCode.PermissionDenied, ex.StatusCode);
    }

    private static MessagingGrpcService CreateService() =>
        new(Mock.Of<ILogger<MessagingGrpcService>>());

    private static ServerCallContext CreateContext() => new FakeServerCallContext();
}

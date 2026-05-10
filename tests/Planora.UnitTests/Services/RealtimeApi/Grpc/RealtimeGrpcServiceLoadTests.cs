using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Grpc.Core;
using Grpc.Core.Testing;
using Planora.Realtime.Api.Grpc;
using Planora.Realtime.Application.Interfaces;
using Planora.GrpcContracts;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Planora.UnitTests.Services.RealtimeApi.Grpc;

public class RealtimeGrpcServiceLoadTests
{
    [Fact]
    public async Task SendNotification_ShouldHandleHighConcurrency()
    {
        var notificationServiceMock = new Mock<INotificationService>();
        notificationServiceMock
            .Setup(x => x.SendNotificationAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        var loggerMock = new Mock<ILogger<RealtimeGrpcService>>();
        var service = new RealtimeGrpcService(notificationServiceMock.Object, loggerMock.Object);

        var context = TestServerCallContext.Create(
            "SendNotification",
            null,
            DateTime.UtcNow.AddMinutes(1),
            new Metadata(),
            CancellationToken.None,
            "127.0.0.1",
            null,
            null,
            _ => Task.CompletedTask,
            () => null,
            _ => { });

        var tasks = new List<Task>();
        for (int i = 0; i < 200; i++)
        {
            var req = new SendNotificationRequest
            {
                UserId = Guid.NewGuid().ToString(),
                Message = "LoadTest",
                Type = "Info"
            };
            tasks.Add(service.SendNotification(req, context));
        }

        await Task.WhenAll(tasks);

        notificationServiceMock.Verify(x => x.SendNotificationAsync(It.IsAny<string>(), "LoadTest", "Info", It.IsAny<CancellationToken>()), Times.Exactly(200));
    }
}

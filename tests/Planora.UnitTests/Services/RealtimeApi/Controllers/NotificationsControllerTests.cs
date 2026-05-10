using System.Security.Claims;
using Planora.Realtime.Api.Controllers;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Requests;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.RealtimeApi.Controllers;

public class NotificationsControllerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public async Task SendNotification_UsesSubjectClaimAndReturnsSuccess()
    {
        var service = new Mock<INotificationService>();
        var controller = CreateController(service, "user-123");
        var request = new SendNotificationRequest { Message = "Hello", Type = "success" };

        var response = await controller.SendNotification(request);

        var ok = Assert.IsType<OkObjectResult>(response);
        Assert.Contains("Notification sent", ok.Value!.ToString(), StringComparison.Ordinal);
        service.Verify(x => x.SendNotificationAsync("user-123", "Hello", "success", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task SendNotification_RejectsMissingSubjectClaim()
    {
        var service = new Mock<INotificationService>();
        var controller = CreateController(service, userId: null);

        var response = await controller.SendNotification(new SendNotificationRequest { Message = "Hello" });

        Assert.IsType<UnauthorizedObjectResult>(response);
        service.VerifyNoOtherCalls();
    }

    [Fact]
    [Trait("TestType", "System")]
    [Trait("TestType", "Acceptance")]
    public async Task BroadcastNotification_SendsToAllUsers()
    {
        var service = new Mock<INotificationService>();
        var controller = CreateController(service, "admin-1");
        var request = new BroadcastNotificationRequest { Message = "Deploy complete", Type = "info" };

        var response = await controller.BroadcastNotification(request);

        var ok = Assert.IsType<OkObjectResult>(response);
        Assert.Contains("Broadcast sent", ok.Value!.ToString(), StringComparison.Ordinal);
        service.Verify(x => x.SendToAllAsync("Deploy complete", "info", It.IsAny<CancellationToken>()), Times.Once);
    }

    private static NotificationsController CreateController(Mock<INotificationService> notificationService, string? userId)
    {
        var identity = userId is null
            ? new ClaimsIdentity()
            : new ClaimsIdentity(new[] { new Claim("sub", userId) }, "test");

        return new NotificationsController(
            notificationService.Object,
            Mock.Of<ILogger<NotificationsController>>())
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(identity)
                }
            }
        };
    }
}

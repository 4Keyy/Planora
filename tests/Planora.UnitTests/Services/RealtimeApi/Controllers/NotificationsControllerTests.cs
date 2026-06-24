using System.Security.Claims;
using Planora.Realtime.Api.Controllers;
using Planora.Realtime.Application.Interfaces;
using Planora.Realtime.Application.Requests;
using Planora.Realtime.Application.Response;
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
        var controller = CreateController(service, userId: "user-123");
        var request = new SendNotificationRequest { Message = "Hello", Type = "success" };

        var response = await controller.SendNotification(request);

        var ok = Assert.IsType<OkObjectResult>(response);
        Assert.Contains("Notification sent", ok.Value!.ToString(), StringComparison.Ordinal);
        service.Verify(x => x.SendNotificationAsync("user-123", "Hello", "success", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Theory]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    [InlineData("PasswordChanged")]
    [InlineData("AccountLocked")]
    public async Task SendNotification_RejectsSecuritySpoofTypes(string spoofType)
    {
        // A client must not be able to self-spoof a security toast: PasswordChanged / AccountLocked
        // can only originate server-side, so they are no longer in the client allowlist.
        var service = new Mock<INotificationService>();
        var controller = CreateController(service, userId: "user-123");

        var response = await controller.SendNotification(
            new SendNotificationRequest { Message = "Your password changed", Type = spoofType });

        var bad = Assert.IsType<BadRequestObjectResult>(response);
        Assert.Contains("INVALID_NOTIFICATION_TYPE", bad.Value!.ToString(), StringComparison.Ordinal);
        service.Verify(
            x => x.SendNotificationAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
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
        var controller = CreateController(service, userId: "admin-1");
        var request = new BroadcastNotificationRequest { Message = "Deploy complete", Type = "info" };

        var response = await controller.BroadcastNotification(request);

        var ok = Assert.IsType<OkObjectResult>(response);
        Assert.Contains("Broadcast sent", ok.Value!.ToString(), StringComparison.Ordinal);
        service.Verify(x => x.SendToAllAsync("Deploy complete", "info", It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task GetSummary_ReturnsStoreSummaryForAuthenticatedUser()
    {
        var userId = Guid.NewGuid();
        var readStore = new Mock<INotificationReadStore>();
        var summary = new NotificationSummary(3, new[]
        {
            new TaskUnread(Guid.NewGuid(), 2, "comment.added", new[]
            {
                new TaskUnreadGroup("comment.added", 2, DateTime.UtcNow),
            }),
        });
        readStore.Setup(x => x.GetSummaryAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(summary);

        var controller = CreateController(new Mock<INotificationService>(), userId.ToString(), readStore);

        var response = await controller.GetSummary(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(response);
        Assert.Same(summary, ok.Value);
        readStore.Verify(x => x.GetSummaryAsync(userId, It.IsAny<CancellationToken>()), Times.Once);
    }

    // REGRESSION: the real JWT pipeline remaps the token's "sub" to ClaimTypes.NameIdentifier
    // (MapInboundClaims defaults to true), so the controller must resolve the id from
    // NameIdentifier too. Reading only "sub" 401'd every notification REST call in production,
    // which the other tests missed by injecting a raw "sub" claim that bypasses the remapping.
    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public async Task GetSummary_AcceptsSubjectRemappedToNameIdentifier()
    {
        var userId = Guid.NewGuid();
        var readStore = new Mock<INotificationReadStore>();
        var summary = NotificationSummary.Empty;
        readStore.Setup(x => x.GetSummaryAsync(userId, It.IsAny<CancellationToken>())).ReturnsAsync(summary);

        var controller = CreateController(
            new Mock<INotificationService>(), userId.ToString(), readStore, claimType: ClaimTypes.NameIdentifier);

        var response = await controller.GetSummary(CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(response);
        Assert.Same(summary, ok.Value);
        readStore.Verify(x => x.GetSummaryAsync(userId, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task GetSummary_RejectsNonGuidSubject()
    {
        var readStore = new Mock<INotificationReadStore>();
        var controller = CreateController(new Mock<INotificationService>(), "not-a-guid", readStore);

        var response = await controller.GetSummary(CancellationToken.None);

        Assert.IsType<UnauthorizedObjectResult>(response);
        readStore.Verify(x => x.GetSummaryAsync(It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Functional")]
    public async Task MarkRead_ForwardsSelectorsAndReturnsFreshSummary()
    {
        var userId = Guid.NewGuid();
        var taskId = Guid.NewGuid();
        var readStore = new Mock<INotificationReadStore>();
        var summary = NotificationSummary.Empty;
        readStore
            .Setup(x => x.MarkReadAsync(userId, false, taskId, null, It.IsAny<CancellationToken>()))
            .ReturnsAsync(summary);

        var controller = CreateController(new Mock<INotificationService>(), userId.ToString(), readStore);

        var response = await controller.MarkRead(
            new MarkNotificationsReadRequest { TaskId = taskId }, CancellationToken.None);

        var ok = Assert.IsType<OkObjectResult>(response);
        Assert.Same(summary, ok.Value);
        readStore.Verify(x => x.MarkReadAsync(userId, false, taskId, null, It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public async Task MarkRead_RejectsMissingSubject()
    {
        var readStore = new Mock<INotificationReadStore>();
        var controller = CreateController(new Mock<INotificationService>(), userId: null, readStore);

        var response = await controller.MarkRead(new MarkNotificationsReadRequest { All = true }, CancellationToken.None);

        Assert.IsType<UnauthorizedObjectResult>(response);
        readStore.Verify(
            x => x.MarkReadAsync(It.IsAny<Guid>(), It.IsAny<bool>(), It.IsAny<Guid?>(),
                It.IsAny<IReadOnlyList<Guid>?>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    private static NotificationsController CreateController(
        Mock<INotificationService> notificationService,
        string? userId,
        Mock<INotificationReadStore>? readStore = null,
        string claimType = "sub")
    {
        var identity = userId is null
            ? new ClaimsIdentity()
            : new ClaimsIdentity(new[] { new Claim(claimType, userId) }, "test");

        return new NotificationsController(
            notificationService.Object,
            (readStore ?? new Mock<INotificationReadStore>()).Object,
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

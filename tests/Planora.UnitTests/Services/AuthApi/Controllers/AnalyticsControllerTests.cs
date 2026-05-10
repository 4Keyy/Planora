using System.Text.Json;
using Planora.Auth.Api.Controllers;
using Planora.Auth.Application.Common.Interfaces;
using Planora.BuildingBlocks.Application.Services;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Controllers;

public sealed class AnalyticsControllerTests
{
    [Fact]
    [Trait("TestType", "Functional")]
    [Trait("TestType", "Regression")]
    public void TrackEvent_ShouldAcceptAllowlistedEventAndLogBusinessEvent()
    {
        var userId = Guid.NewGuid();
        var logger = new Mock<IBusinessEventLogger>();
        var currentUser = new Mock<ICurrentUserService>();
        currentUser.SetupGet(x => x.UserId).Returns(userId);
        using var properties = JsonDocument.Parse("""{"surface":"restore"}""");
        var controller = new AnalyticsController(logger.Object, currentUser.Object);

        var result = controller.TrackEvent(new TrackAnalyticsEventRequest
        {
            EventName = BusinessEvents.SessionRestored,
            Properties = properties.RootElement,
            OccurredAt = DateTimeOffset.UtcNow
        });

        Assert.IsType<AcceptedResult>(result);
        logger.Verify(x => x.LogBusinessEvent(
                BusinessEvents.SessionRestored,
                It.IsAny<string>(),
                It.IsAny<object>(),
                userId.ToString()),
            Times.Once);
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void TrackEvent_ShouldRejectUnknownNonObjectAndOversizedProperties()
    {
        var logger = new Mock<IBusinessEventLogger>();
        var controller = new AnalyticsController(logger.Object, Mock.Of<ICurrentUserService>());

        Assert.IsType<BadRequestObjectResult>(controller.TrackEvent(new TrackAnalyticsEventRequest
        {
            EventName = "NOT_ALLOWED"
        }));

        using var nonObject = JsonDocument.Parse("""["bad"]""");
        Assert.IsType<BadRequestObjectResult>(controller.TrackEvent(new TrackAnalyticsEventRequest
        {
            EventName = BusinessEvents.SessionRestored,
            Properties = nonObject.RootElement
        }));

        using var oversized = JsonDocument.Parse($$"""{"payload":"{{new string('x', 4097)}}" }""");
        Assert.IsType<BadRequestObjectResult>(controller.TrackEvent(new TrackAnalyticsEventRequest
        {
            EventName = BusinessEvents.SessionRestored,
            Properties = oversized.RootElement
        }));

        logger.Verify(x => x.LogBusinessEvent(
                It.IsAny<string>(),
                It.IsAny<string>(),
                It.IsAny<object>(),
                It.IsAny<string?>()),
            Times.Never);
    }
}

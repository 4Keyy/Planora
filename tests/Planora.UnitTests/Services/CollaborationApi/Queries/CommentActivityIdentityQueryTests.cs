using System.Text.Json;
using Moq;
using Planora.BuildingBlocks.Application.Context;
using Planora.Collaboration.Application.DTOs;
using Planora.Collaboration.Application.Features.Comments.Queries.GetComments;
using Planora.Collaboration.Application.Services;
using Planora.Collaboration.Domain.Entities;
using Planora.Collaboration.Domain.Repositories;

namespace Planora.UnitTests.Services.CollaborationApi.Queries;

public sealed class CommentActivityIdentityQueryTests
{
    [Fact]
    public async Task GetComments_ProjectsSourceIdentityWithoutChangingTextOrLegacyRows()
    {
        var task = Guid.NewGuid();
        var viewer = Guid.NewGuid();
        var source = Guid.NewGuid();
        const string text = "Synthetic Actor completed a subtask: Same title";
        var activity = Comment.CreateSystem(task, text, source);
        var legacy = Comment.CreateSystem(task, text);
        var regular = Comment.Create(task, viewer, "Synthetic Actor", "Regular message");
        var comments = new Mock<ICommentRepository>();
        comments.Setup(repo => repo.GetPagedByTaskIdAsync(task, 1, 50, It.IsAny<CancellationToken>()))
            .ReturnsAsync((new[] { activity, legacy, regular }, 3));
        var currentUser = new Mock<ICurrentUserContext>();
        currentUser.SetupGet(context => context.UserId).Returns(viewer);
        var access = new Mock<ITaskAccessService>();
        access.Setup(service => service.CheckCommentAccessAsync(task, viewer, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new TaskAccessResult(true, true, viewer, new[] { viewer }, "Pinned note", DateTime.UtcNow));
        var users = new Mock<IUserService>();
        users.Setup(service => service.GetUserProfilesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<Guid, UserProfile>());
        var handler = new GetCommentsQueryHandler(comments.Object, currentUser.Object, access.Object, users.Object);

        var result = await handler.Handle(new GetCommentsQuery(task), CancellationToken.None);

        Assert.True(result.IsSuccess);
        var items = result.Value!.Items;
        Assert.Equal(4, items.Count());
        var mapped = Assert.Single(items, item => item.Id == activity.Id);
        Assert.Equal(text, mapped.Content);
        Assert.True(mapped.IsSystemComment);
        var json = JsonSerializer.SerializeToElement(mapped, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.True(json.TryGetProperty("sourceSubtaskId", out var identity));
        Assert.Equal(source, identity.GetGuid());
        foreach (var other in items.Where(item => item.Id != activity.Id))
        {
            var otherJson = JsonSerializer.SerializeToElement(other, new JsonSerializerOptions(JsonSerializerDefaults.Web));
            Assert.True(otherJson.TryGetProperty("sourceSubtaskId", out var absentIdentity));
            Assert.Equal(JsonValueKind.Null, absentIdentity.ValueKind);
        }
        Assert.Equal(text, Assert.Single(items, item => item.Id == legacy.Id).Content);
    }

    [Fact]
    public void CommentDto_PreIdentityPayloadRemainsReadableWithNoSourceIdentity()
    {
        var original = new CommentDto(Guid.NewGuid(), Guid.NewGuid(), Guid.Empty, string.Empty, null,
            "Legacy activity", DateTime.UtcNow, null, false, false, IsSystemComment: true);
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var payload = JsonSerializer.SerializeToNode(original, options)!.AsObject();
        payload.Remove("sourceSubtaskId");

        var restored = JsonSerializer.Deserialize<CommentDto>(payload.ToJsonString(), options)!;

        Assert.Equal(original.Id, restored.Id);
        Assert.Equal(original.Content, restored.Content);
        Assert.True(restored.IsSystemComment);
        var json = JsonSerializer.SerializeToElement(restored, options);
        Assert.True(json.TryGetProperty("sourceSubtaskId", out var source));
        Assert.Equal(JsonValueKind.Null, source.ValueKind);
    }
}

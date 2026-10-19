using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;

namespace Planora.UnitTests.Services.TodoApi.Validators;

public sealed class DirectSharingLimitTests
{
    [Theory]
    [InlineData(12, true)]
    [InlineData(13, false)]
    public async Task Create_DirectAudience_IsLimitedToTwelveDistinctFriends(int count, bool valid)
    {
        var command = Create(Friends(count));
        var result = await new CreateTodoCommandValidator().ValidateAsync(command);

        Assert.Equal(valid, result.IsValid);
        if (!valid)
        {
            var error = Assert.Single(result.Errors);
            Assert.Equal(nameof(command.SharedWithUserIds), error.PropertyName);
            Assert.Equal("A task can be shared with at most 12 friends", error.ErrorMessage);
        }
    }

    [Theory]
    [InlineData(12, true)]
    [InlineData(13, false)]
    public async Task Update_DirectAudience_IsLimitedToTwelveDistinctFriends(int count, bool valid)
    {
        var result = await new UpdateTodoCommandValidator().ValidateAsync(
            new UpdateTodoCommand(Guid.NewGuid(), IsPublic: false, SharedWithUserIds: Friends(count)));

        Assert.Equal(valid, result.IsValid);
        if (!valid)
            Assert.Equal("A task can be shared with at most 12 friends", Assert.Single(result.Errors).ErrorMessage);
    }

    [Fact]
    public async Task EmptyIdsAndDuplicates_DoNotIncreaseDirectAudience()
    {
        var friends = Friends(12);
        Guid[] shares = [.. friends, .. friends, Guid.Empty, Guid.Empty];

        Assert.True((await new CreateTodoCommandValidator().ValidateAsync(Create(shares))).IsValid);
        Assert.True((await new UpdateTodoCommandValidator().ValidateAsync(
            new UpdateTodoCommand(Guid.NewGuid(), IsPublic: false, SharedWithUserIds: shares))).IsValid);
    }

    [Fact]
    public async Task AllFriends_IsNotLimitedToTwelve()
    {
        var friends = Friends(20);

        Assert.True((await new CreateTodoCommandValidator().ValidateAsync(Create(friends) with { IsPublic = true })).IsValid);
        Assert.True((await new UpdateTodoCommandValidator().ValidateAsync(
            new UpdateTodoCommand(Guid.NewGuid(), IsPublic: true, SharedWithUserIds: friends))).IsValid);
    }

    [Fact]
    public async Task Update_WithoutAudience_DoesNotApplyTheLimit()
    {
        Assert.True((await new UpdateTodoCommandValidator().ValidateAsync(new UpdateTodoCommand(Guid.NewGuid(), Title: "renamed"))).IsValid);
    }

    [Fact]
    public async Task Update_OmittedPublicFlag_DefersStateDependentLimitToAuthorisedHandler()
    {
        var result = await new UpdateTodoCommandValidator().ValidateAsync(
            new UpdateTodoCommand(Guid.NewGuid(), SharedWithUserIds: Friends(13)));

        Assert.True(result.IsValid);
    }

    private static Guid[] Friends(int count) => Enumerable.Range(0, count).Select(_ => Guid.NewGuid()).ToArray();
    private static CreateTodoCommand Create(IReadOnlyList<Guid> friends) => new(null, "Task", null, null, null, null, SharedWithUserIds: friends);
}

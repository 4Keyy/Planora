using Planora.Auth.Domain.Events;
using Planora.Category.Domain.Events;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Domain.ValueObjects;

namespace Planora.UnitTests.Services;

public sealed class DomainEventContractTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void AuthAndCategoryDomainEvents_ShouldExposeConstructorValues()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();

        var loggedIn = new UserLoggedInEvent(userId, "user@example.com", "127.0.0.1");
        var categoryCreated = new CategoryCreatedDomainEvent(categoryId, userId, "Inbox", true);
        var categorySetAsDefault = new CategorySetAsDefaultDomainEvent(categoryId, userId);

        Assert.Equal(userId, loggedIn.UserId);
        Assert.Equal("user@example.com", loggedIn.Email);
        Assert.Equal("127.0.0.1", loggedIn.IpAddress);
        Assert.Equal(categoryId, categoryCreated.CategoryId);
        Assert.Equal(userId, categoryCreated.UserId);
        Assert.Equal("Inbox", categoryCreated.Name);
        Assert.True(categoryCreated.IsDefault);
        Assert.Equal(categoryId, categorySetAsDefault.CategoryId);
        Assert.Equal(userId, categorySetAsDefault.UserId);
    }

    [Theory]
    [InlineData(TodoStatus.Todo, "Todo")]
    [InlineData(TodoStatus.InProgress, "In Progress")]
    [InlineData(TodoStatus.Done, "Done")]
    [InlineData((TodoStatus)999, "Unknown")]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void TodoStatusDisplay_ShouldReturnHumanReadableLabels(TodoStatus status, string expected)
    {
        Assert.Equal(expected, status.Display());
    }

    [Theory]
    [InlineData("todo", TodoStatus.Todo)]
    [InlineData("pending", TodoStatus.Todo)]
    [InlineData("in progress", TodoStatus.InProgress)]
    [InlineData("done", TodoStatus.Done)]
    [InlineData("completed", TodoStatus.Done)]
    [InlineData("unknown", null)]
    [InlineData(null, null)]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void TodoStatusFromString_ShouldParseAliasesAndRejectUnknownValues(string? value, TodoStatus? expected)
    {
        Assert.Equal(expected, TodoStatusExtensions.FromString(value));
    }
}

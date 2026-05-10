using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;

namespace Planora.UnitTests.Services.TodoApi.Domain;

public class TodoItemDomainTests
{
    [Fact]
    public void Create_ShouldTrimFieldsAndNormalizeSharedUsers()
    {
        var ownerId = Guid.NewGuid();
        var friendId = Guid.NewGuid();
        var anotherFriendId = Guid.NewGuid();

        var todo = TodoItem.Create(
            ownerId,
            "  Write tests  ",
            "  Cover the domain  ",
            priority: TodoPriority.High,
            isPublic: true,
            sharedWithUserIds: new[] { friendId, friendId, ownerId, Guid.Empty, anotherFriendId });

        Assert.Equal(ownerId, todo.UserId);
        Assert.Equal("Write tests", todo.Title);
        Assert.Equal("Cover the domain", todo.Description);
        Assert.Equal(TodoPriority.High, todo.Priority);
        Assert.True(todo.IsPublic);
        Assert.Equal(2, todo.SharedWith.Count);
        Assert.DoesNotContain(todo.SharedWith, share => share.SharedWithUserId == ownerId);
        Assert.Contains(todo.DomainEvents, e => e.GetType().Name == "TodoItemCreatedDomainEvent");
    }

    [Fact]
    public void CreateAndUpdateTitle_ShouldRejectEmptyTitle()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task");

        Assert.Throws<InvalidValueObjectException>(() => TodoItem.Create(ownerId, ""));
        Assert.Throws<InvalidValueObjectException>(() => todo.UpdateTitle(" ", ownerId));
    }

    [Fact]
    public void UpdateMethods_ShouldChangeMutableFieldsAndMarkHiddenPublicAndCategory()
    {
        var ownerId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task");

        todo.UpdateTitle("  New title  ", ownerId);
        todo.UpdateDescription("  Description  ", ownerId);
        todo.UpdateCategory(categoryId, ownerId);
        todo.UpdatePriority(TodoPriority.Urgent, ownerId);
        todo.UpdateDueDate(DateTime.UtcNow.AddDays(-10), ownerId);
        todo.SetPublic(true, ownerId);
        todo.SetHidden(true, ownerId);

        Assert.Equal("New title", todo.Title);
        Assert.Equal("Description", todo.Description);
        Assert.Equal(categoryId, todo.CategoryId);
        Assert.Equal(TodoPriority.Urgent, todo.Priority);
        Assert.True(todo.IsPublic);
        Assert.True(todo.Hidden);
        Assert.NotNull(todo.UpdatedAt);
        Assert.Equal(ownerId, todo.UpdatedBy);
    }

    [Fact]
    public void ExpectedAndActualDates_ShouldCalculateCompletionTiming()
    {
        var ownerId = Guid.NewGuid();
        var expectedDate = DateTime.UtcNow.AddDays(2);
        var actualDate = DateTime.UtcNow.AddDays(1);
        var todo = TodoItem.Create(ownerId, "Task", expectedDate: expectedDate);

        Assert.Throws<InvalidValueObjectException>(() =>
            todo.UpdateExpectedDate(DateTime.UtcNow.AddSeconds(-1), ownerId));

        todo.UpdateActualDate(actualDate, ownerId);

        Assert.True(todo.IsCompleted);
        Assert.Equal(TodoStatus.Done, todo.Status);
        Assert.Equal(actualDate, todo.ActualDate);
        Assert.NotNull(todo.CompletedAt);
        Assert.True(todo.IsOnTime());
        Assert.Null(todo.GetDelay());
    }

    [Fact]
    public void Delay_ShouldBeReturnedOnlyWhenActualDateIsAfterExpectedDate()
    {
        var ownerId = Guid.NewGuid();
        var expectedDate = DateTime.UtcNow.AddDays(1);
        var actualDate = expectedDate.AddHours(3);
        var todo = TodoItem.Create(ownerId, "Task", expectedDate: expectedDate);

        todo.UpdateActualDate(actualDate, ownerId);

        Assert.False(todo.IsOnTime());
        Assert.Equal(TimeSpan.FromHours(3), todo.GetDelay());
    }

    [Fact]
    public void CompletionWorkflow_ShouldRejectInvalidTransitions()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task");

        todo.MarkAsInProgress(ownerId);
        Assert.Equal(TodoStatus.InProgress, todo.Status);

        todo.MarkAsTodo(ownerId);
        Assert.Equal(TodoStatus.Todo, todo.Status);

        todo.MarkAsDone(ownerId);
        Assert.True(todo.IsCompleted);

        Assert.Throws<BusinessRuleViolationException>(() => todo.MarkAsDone(ownerId));
        Assert.Throws<BusinessRuleViolationException>(() => todo.MarkAsInProgress(ownerId));

        todo.MarkAsTodo(ownerId);
        Assert.Equal(TodoStatus.Todo, todo.Status);
        Assert.Null(todo.CompletedAt);
    }

    [Fact]
    public void TagMethods_ShouldValidateDuplicatesMissingTagsAndClear()
    {
        var ownerId = Guid.NewGuid();
        var todo = TodoItem.Create(ownerId, "Task");

        Assert.Throws<InvalidValueObjectException>(() => todo.AddTag(" ", ownerId));

        todo.AddTag("  Backend  ", ownerId);

        Assert.Single(todo.Tags);
        Assert.Equal("Backend", todo.Tags.Single().Name);
        Assert.Throws<BusinessRuleViolationException>(() => todo.AddTag("backend", ownerId));

        todo.RemoveTag("BACKEND", ownerId);
        Assert.Empty(todo.Tags);
        Assert.Throws<EntityNotFoundException>(() => todo.RemoveTag("missing", ownerId));

        todo.AddTag("api", ownerId);
        todo.AddTag("security", ownerId);
        todo.ClearTags(ownerId);

        Assert.Empty(todo.Tags);
    }
}

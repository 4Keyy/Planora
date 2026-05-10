using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Specifications;
using CategoryEntity = Planora.Category.Domain.Entities.Category;
using CategoriesForUserSpecification = Planora.Category.Domain.Specifications.CategoriesForUserSpecification;

namespace Planora.UnitTests.Services.TodoApi.Domain;

public sealed class TodoSpecificationTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void CompletedTodosForUserSpecification_ShouldMatchRecentCompletedNonDeletedTodosAndConfigureIncludesOrdering()
    {
        var userId = Guid.NewGuid();
        var recentCompleted = TodoItem.Create(userId, "Recent done");
        recentCompleted.MarkAsDone(userId);
        var active = TodoItem.Create(userId, "Active");
        var deleted = TodoItem.Create(userId, "Deleted done");
        deleted.MarkAsDone(userId);
        deleted.MarkAsDeleted(userId);
        var otherUserCompleted = TodoItem.Create(Guid.NewGuid(), "Other done");
        otherUserCompleted.MarkAsDone(otherUserCompleted.UserId);
        var oldCompleted = TodoItem.Create(userId, "Old done");
        oldCompleted.MarkAsDone(userId);
        typeof(TodoItem).GetProperty(nameof(TodoItem.CompletedAt))!
            .SetValue(oldCompleted, DateTime.UtcNow.AddDays(-30));
        var specification = new CompletedTodosForUserSpecification(userId, days: 7);
        var predicate = specification.Criteria!.Compile();

        Assert.True(predicate(recentCompleted));
        Assert.False(predicate(active));
        Assert.False(predicate(deleted));
        Assert.False(predicate(otherUserCompleted));
        Assert.False(predicate(oldCompleted));
        Assert.Single(specification.Includes);
        Assert.NotNull(specification.OrderByDescending);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void TodosByCategorySpecification_ShouldMatchOwnedNonDeletedTodosInCategoryAndOrderByPriority()
    {
        var userId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var matching = TodoItem.Create(userId, "Match", categoryId: categoryId);
        var differentCategory = TodoItem.Create(userId, "Other category", categoryId: Guid.NewGuid());
        var differentUser = TodoItem.Create(Guid.NewGuid(), "Other user", categoryId: categoryId);
        var deleted = TodoItem.Create(userId, "Deleted", categoryId: categoryId);
        deleted.MarkAsDeleted(userId);
        var specification = new TodosByCategorySpecification(userId, categoryId);
        var predicate = specification.Criteria!.Compile();

        Assert.True(predicate(matching));
        Assert.False(predicate(differentCategory));
        Assert.False(predicate(differentUser));
        Assert.False(predicate(deleted));
        Assert.Single(specification.Includes);
        Assert.NotNull(specification.OrderBy);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ActiveTodosForUserSpecification_ShouldMatchOwnedNonDeletedTodosAndConfigureIncludesOrdering()
    {
        var userId = Guid.NewGuid();
        var active = TodoItem.Create(userId, "Active");
        var deleted = TodoItem.Create(userId, "Deleted");
        deleted.MarkAsDeleted(userId);
        var otherUser = TodoItem.Create(Guid.NewGuid(), "Other user");
        var specification = new ActiveTodosForUserSpecification(userId);
        var predicate = specification.Criteria!.Compile();

        Assert.True(predicate(active));
        Assert.False(predicate(deleted));
        Assert.False(predicate(otherUser));
        Assert.Single(specification.Includes);
        Assert.NotNull(specification.OrderByDescending);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void CategoriesForUserSpecification_ShouldFilterArchivedUnlessRequestedAndOrderByDisplayOrder()
    {
        var userId = Guid.NewGuid();
        var active = CategoryEntity.Create(userId, "Active", null, "#112233", null, 1);
        var archived = CategoryEntity.Create(userId, "Archived", null, "#445566", null, 2);
        archived.Archive();
        var otherUser = CategoryEntity.Create(Guid.NewGuid(), "Other", null, "#778899", null, 3);
        var defaultSpec = new CategoriesForUserSpecification(userId);
        var includeArchivedSpec = new CategoriesForUserSpecification(userId, includeArchived: true);

        Assert.True(defaultSpec.Criteria!.Compile()(active));
        Assert.False(defaultSpec.Criteria!.Compile()(archived));
        Assert.False(defaultSpec.Criteria!.Compile()(otherUser));
        Assert.True(includeArchivedSpec.Criteria!.Compile()(archived));
        Assert.NotNull(defaultSpec.OrderBy);
    }
}

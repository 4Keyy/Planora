using Planora.BuildingBlocks.Infrastructure;
using Planora.Category.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence.Repositories;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Enums;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;

namespace Planora.UnitTests.Services.Infrastructure;

public class RepositoryBehaviorTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CategoryRepository_CoversFilteringOrderingPagingAndMutations()
    {
        await using var context = CreateCategoryContext();
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var inbox = CategoryEntity.Create(userId, "Inbox", "Main", "#111111", "Inbox", 2);
        var work = CategoryEntity.Create(userId, "Work", null, "#222222", "Briefcase", 1);
        var archived = CategoryEntity.Create(userId, "Archived", null, "#333333", null, 3);
        var deleted = CategoryEntity.Create(userId, "Deleted", null, "#444444", null, 4);
        var other = CategoryEntity.Create(otherUserId, "Other", null, "#555555", null, 1);
        archived.Archive();
        deleted.Delete(userId);
        await context.Categories.AddRangeAsync(inbox, work, archived, deleted, other);
        await context.SaveChangesAsync();
        var repository = new CategoryRepository(context);

        Assert.Same(inbox, await repository.GetByIdAsync(inbox.Id));
        // GetByIdAsync honors the global soft-delete filter: a deleted category is unreachable by id.
        Assert.Null(await repository.GetByIdAsync(deleted.Id));
        Assert.Equal(4, (await repository.GetAllAsync()).Count);
        Assert.Equal(new[] { work.Id, inbox.Id, archived.Id }, (await repository.GetByUserIdAsync(userId)).Select(x => x.Id));
        Assert.Equal(new[] { work.Id, inbox.Id }, (await repository.GetActiveByUserIdAsync(userId)).Select(x => x.Id));
        Assert.Same(work, await repository.GetByIdAndUserIdAsync(work.Id, userId));
        Assert.Null(await repository.GetByIdAndUserIdAsync(deleted.Id, userId));
        Assert.True(await repository.ExistsByNameAndUserIdAsync("Inbox", userId));
        Assert.False(await repository.ExistsByNameAndUserIdAsync("Deleted", userId));
        Assert.Equal(3, await repository.CountAsync(x => x.UserId == userId && !x.IsDeleted));
        Assert.Equal(work.Id, (await repository.FindFirstAsync(x => x.Name == "Work"))!.Id);
        // FindAsync honors the global soft-delete filter: the deleted category is
        // excluded even though the predicate does not mention IsDeleted.
        Assert.Equal(
            new[] { archived.Id, inbox.Id }.OrderBy(x => x),
            (await repository.FindAsync(x => x.UserId == userId && x.Order >= 2)).Select(x => x.Id).OrderBy(x => x));

        var page = await repository.GetPagedAsync(
            pageNumber: 1,
            pageSize: 2,
            predicate: x => x.UserId == userId && !x.IsDeleted,
            orderBy: x => x.Order,
            ascending: false);
        Assert.Equal(3, page.TotalCount);
        Assert.Equal(new[] { archived.Id, inbox.Id }, page.Items.Select(x => x.Id));

        var normalizedPage = await repository.GetPagedAsync(
            pageNumber: 0,
            pageSize: 500,
            predicate: x => x.UserId == userId && !x.IsDeleted,
            orderBy: x => x.Order);
        Assert.Equal(3, normalizedPage.TotalCount);
        Assert.Equal(3, normalizedPage.Items.Count);

        var added = await repository.AddAsync(CategoryEntity.Create(userId, "Later", null, "#666666", null, 9));
        Assert.Equal("Later", added.Name);
        repository.Update(inbox);
        repository.UpdateRange(new[] { inbox, work });
        repository.Remove(other);
        await repository.AddRangeAsync(new[] { CategoryEntity.Create(userId, "Batch", null, "#777777", null, 10) });
        Assert.True(await repository.SaveChangesAsync() > 0);
        repository.RemoveRange(await repository.FindAsync(x => x.Name == "Batch"));
        await repository.SaveChangesAsync();
        Assert.False(await repository.ExistsAsync(x => x.UserId == otherUserId));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task TodoRepository_CoversQueryFiltersIncludesPagingAndCounts()
    {
        await using var context = CreateTodoContext();
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var sharedUserId = Guid.NewGuid();
        var active = TodoItem.Create(
            userId,
            "Active",
            categoryId: categoryId,
            expectedDate: DateTime.UtcNow.AddDays(2),
            sharedWithUserIds: new[] { sharedUserId });
        active.AddTag("focus", userId);
        var overdue = TodoItem.Create(userId, "Overdue", categoryId: categoryId, expectedDate: DateTime.UtcNow.AddDays(-1));
        var completed = TodoItem.Create(userId, "Completed", categoryId: categoryId, expectedDate: DateTime.UtcNow.AddDays(1));
        completed.MarkAsDone(userId);
        var deleted = TodoItem.Create(userId, "Deleted", categoryId: categoryId);
        deleted.MarkAsDeleted(userId);
        var other = TodoItem.Create(otherUserId, "Other", categoryId: Guid.NewGuid());
        await context.TodoItems.AddRangeAsync(active, overdue, completed, deleted, other);
        await context.SaveChangesAsync();
        var repository = new TodoRepository(context);
        var itemRepository = new TodoItemRepository(context);

        Assert.NotNull(await itemRepository.GetByIdAsync(active.Id));
        // BuildingBlocks BaseRepository.GetByIdAsync excludes soft-deleted entities.
        Assert.Null(await itemRepository.GetByIdAsync(deleted.Id));
        Assert.Contains((await repository.GetByUserIdAsync(userId)), x => x.Id == active.Id);
        Assert.DoesNotContain((await repository.GetByUserIdAsync(userId)), x => x.UserId == otherUserId);
        Assert.Contains((await repository.GetActiveByUserIdAsync(userId)), x => x.Id == active.Id);
        Assert.DoesNotContain((await repository.GetActiveByUserIdAsync(userId)), x => x.Id == completed.Id);
        Assert.Single(await repository.GetCompletedByUserIdAsync(userId));
        Assert.Equal(3, (await repository.GetByUserIdAndCategoryIdAsync(userId, categoryId)).Count);
        Assert.DoesNotContain((await repository.GetByCategoryIdAsync(categoryId)), x => x.Id == deleted.Id);
        Assert.Equal(2, await repository.GetUncompletedCountAsync(userId));
        Assert.Equal(overdue.Id, Assert.Single(await repository.GetOverdueAsync(userId)).Id);

        var withIncludes = await repository.GetByIdWithIncludesAsync(active.Id);
        Assert.NotNull(withIncludes);
        Assert.Single(withIncludes.Tags);
        Assert.Single(withIncludes.SharedWith);
        Assert.Null(await repository.GetByIdWithIncludesAsync(deleted.Id));

        var createdPage = await repository.FindPageWithIncludesAsync(
            x => x.UserId == userId,
            sortCompletedByCompletionTime: false,
            pageNumber: -5,
            pageSize: 500);
        Assert.Equal(3, createdPage.TotalCount);
        Assert.True(createdPage.Items.Count <= 100);

        var completedFirst = await repository.FindPageWithIncludesAsync(
            x => x.UserId == userId,
            sortCompletedByCompletionTime: true,
            pageNumber: 1,
            pageSize: 10);
        Assert.Contains(completedFirst.Items, x => x.Id == completed.Id);

        Assert.Equal(new[] { active.Id }, (await repository.FindWithIncludesAsync(x => x.Id == active.Id)).Select(x => x.Id));

        var paged = await repository.GetPagedWithIncludesAsync(
            x => x.UserId == userId,
            pageNumber: 0,
            pageSize: 500,
            sortCompletedByCompletionTime: true);
        Assert.Equal(3, paged.TotalCount);
        Assert.Equal(3, paged.Items.Count);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task TodoRepository_RemoveSharesBetweenUsers_RemovesBothDirectionsAndKeepsOthers()
    {
        await using var context = CreateTodoContext();
        var alice = Guid.NewGuid();
        var bob = Guid.NewGuid();
        var carol = Guid.NewGuid();
        var aliceToBob = TodoItem.Create(alice, "Alice shares with Bob", categoryId: Guid.NewGuid(), sharedWithUserIds: new[] { bob });
        var bobToAlice = TodoItem.Create(bob, "Bob shares with Alice", categoryId: Guid.NewGuid(), sharedWithUserIds: new[] { alice });
        var aliceToCarol = TodoItem.Create(alice, "Alice shares with Carol", categoryId: Guid.NewGuid(), sharedWithUserIds: new[] { carol });
        await context.TodoItems.AddRangeAsync(aliceToBob, bobToAlice, aliceToCarol);
        await context.SaveChangesAsync();
        var repository = new TodoRepository(context);

        await repository.RemoveSharesBetweenUsersAsync(alice, bob);

        // Both directions between Alice and Bob are removed; the unrelated Alice->Carol share survives.
        var remaining = await context.TodoItemShares.AsNoTracking().ToListAsync();
        Assert.Equal(new[] { aliceToCarol.Id }, remaining.Select(s => s.TodoItemId));
        Assert.Equal(carol, Assert.Single(remaining).SharedWithUserId);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task AuthBaseRepository_GetByIdAsync_HonorsSoftDeleteQueryFilter()
    {
        await using var context = CreateAuthContext();
        var active = Planora.Auth.Domain.Entities.User.Create(
            Planora.Auth.Domain.ValueObjects.Email.Create("active@planora.test"), "hash", "Ann", "Active");
        var removed = Planora.Auth.Domain.Entities.User.Create(
            Planora.Auth.Domain.ValueObjects.Email.Create("removed@planora.test"), "hash", "Rob", "Removed");
        removed.MarkAsDeleted(removed.Id);
        await context.Users.AddRangeAsync(active, removed);
        await context.SaveChangesAsync();
        var repository = new Planora.Auth.Infrastructure.Persistence.Repositories.UserRepository(context);

        Assert.NotNull(await repository.GetByIdAsync(active.Id));
        // GetByIdAsync uses FirstOrDefaultAsync, so the soft-delete query filter applies
        // and a deleted user is never returned by id (FindAsync would have bypassed it).
        Assert.Null(await repository.GetByIdAsync(removed.Id));
    }

    private static Planora.Auth.Infrastructure.Persistence.AuthDbContext CreateAuthContext()
    {
        var options = new DbContextOptionsBuilder<Planora.Auth.Infrastructure.Persistence.AuthDbContext>()
            .UseInMemoryDatabase($"auth-repository-{Guid.NewGuid():N}")
            .Options;

        return new Planora.Auth.Infrastructure.Persistence.AuthDbContext(
            options, Mock.Of<Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher>());
    }

    private static CategoryDbContext CreateCategoryContext()
    {
        var options = new DbContextOptionsBuilder<CategoryDbContext>()
            .UseInMemoryDatabase($"category-repository-{Guid.NewGuid():N}")
            .Options;

        return new CategoryDbContext(options, Mock.Of<IDomainEventDispatcher>());
    }

    private static TodoDbContext CreateTodoContext()
    {
        var options = new DbContextOptionsBuilder<TodoDbContext>()
            .UseInMemoryDatabase($"todo-repository-{Guid.NewGuid():N}")
            .Options;

        return new TodoDbContext(options);
    }
}

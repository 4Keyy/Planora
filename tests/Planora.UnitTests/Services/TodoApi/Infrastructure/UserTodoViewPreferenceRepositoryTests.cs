using Planora.Todo.Domain.Entities;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;

namespace Planora.UnitTests.Services.TodoApi.Infrastructure;

public sealed class UserTodoViewPreferenceRepositoryTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task Repository_ShouldQueryPreferencesByViewerTodoCategoryAndHiddenState()
    {
        using var context = CreateContext();
        var repository = new UserTodoViewPreferenceRepository(context);
        var viewerId = Guid.NewGuid();
        var otherViewerId = Guid.NewGuid();
        var hiddenTodoId = Guid.NewGuid();
        var visibleTodoId = Guid.NewGuid();
        var otherViewerTodoId = Guid.NewGuid();
        var categoryId = Guid.NewGuid();
        var otherCategoryId = Guid.NewGuid();

        var hiddenPreference = new UserTodoViewPreference
        {
            ViewerId = viewerId,
            TodoItemId = hiddenTodoId,
            HiddenByViewer = true,
            ViewerCategoryId = categoryId
        };
        var visiblePreference = new UserTodoViewPreference
        {
            ViewerId = viewerId,
            TodoItemId = visibleTodoId,
            HiddenByViewer = false,
            ViewerCategoryId = otherCategoryId
        };
        var otherViewerPreference = new UserTodoViewPreference
        {
            ViewerId = otherViewerId,
            TodoItemId = otherViewerTodoId,
            HiddenByViewer = true,
            ViewerCategoryId = categoryId
        };

        context.UserTodoViewPreferences.AddRange(hiddenPreference, visiblePreference, otherViewerPreference);
        await context.SaveChangesAsync();

        Assert.Equal(new[] { hiddenTodoId }, await repository.GetHiddenTodoIdsAsync(viewerId));

        var byViewer = await repository.GetByViewerIdAsync(viewerId);
        Assert.Equal(2, byViewer.Count);
        Assert.Same(hiddenPreference, byViewer[hiddenTodoId]);
        Assert.Same(visiblePreference, byViewer[visibleTodoId]);

        Assert.Empty(await repository.GetByViewerIdForTodosAsync(viewerId, Array.Empty<Guid>()));
        var byRequestedTodos = await repository.GetByViewerIdForTodosAsync(
            viewerId,
            new[] { hiddenTodoId, otherViewerTodoId });
        Assert.Single(byRequestedTodos);
        Assert.True(byRequestedTodos[hiddenTodoId].HiddenByViewer);

        Assert.Equal(new[] { hiddenTodoId }, await repository.GetTodoIdsByViewerCategoryAsync(viewerId, categoryId));
        Assert.Same(visiblePreference, await repository.GetAsync(viewerId, visibleTodoId));
        Assert.Null(await repository.GetAsync(viewerId, Guid.NewGuid()));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task UpsertAsync_ShouldInsertNewPreferenceAndUpdateExistingPreference()
    {
        using var context = CreateContext();
        var repository = new UserTodoViewPreferenceRepository(context);
        var viewerId = Guid.NewGuid();
        var todoItemId = Guid.NewGuid();
        var initialCategoryId = Guid.NewGuid();
        var updatedCategoryId = Guid.NewGuid();

        await repository.UpsertAsync(new UserTodoViewPreference
        {
            ViewerId = viewerId,
            TodoItemId = todoItemId,
            HiddenByViewer = false,
            ViewerCategoryId = initialCategoryId
        });
        await context.SaveChangesAsync();

        var inserted = await repository.GetAsync(viewerId, todoItemId);
        Assert.NotNull(inserted);
        Assert.False(inserted!.HiddenByViewer);
        Assert.Equal(initialCategoryId, inserted.ViewerCategoryId);

        await repository.UpsertAsync(new UserTodoViewPreference
        {
            ViewerId = viewerId,
            TodoItemId = todoItemId,
            HiddenByViewer = true,
            ViewerCategoryId = updatedCategoryId
        });
        await context.SaveChangesAsync();

        var updated = Assert.Single(context.UserTodoViewPreferences);
        Assert.True(updated.HiddenByViewer);
        Assert.Equal(updatedCategoryId, updated.ViewerCategoryId);
    }

    private static TodoDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<TodoDbContext>()
            .UseInMemoryDatabase($"todo-view-preferences-{Guid.NewGuid():N}")
            .Options;

        return new TodoDbContext(options);
    }
}

using Planora.Todo.Domain.Entities;

namespace Planora.UnitTests.Services.TodoApi.Domain;

public sealed class TodoViewerStateResolverTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Resolver_ShouldApplyOwnerAndViewerSpecificHiddenAndCategoryState()
    {
        var ownerId = Guid.NewGuid();
        var viewerId = Guid.NewGuid();
        var ownerCategoryId = Guid.NewGuid();
        var viewerCategoryId = Guid.NewGuid();
        var privateTodo = TodoItem.Create(ownerId, "Private todo", categoryId: ownerCategoryId);
        privateTodo.SetHidden(true, ownerId);
        var sharedTodo = TodoItem.Create(
            ownerId,
            "Shared todo",
            categoryId: ownerCategoryId,
            sharedWithUserIds: new[] { viewerId });
        var preference = new UserTodoViewPreference
        {
            ViewerId = viewerId,
            TodoItemId = sharedTodo.Id,
            HiddenByViewer = true,
            ViewerCategoryId = viewerCategoryId
        };

        Assert.False(Invoke<bool>("HasSharedAudience", privateTodo));
        Assert.True(Invoke<bool>("GetEffectiveHidden", privateTodo, viewerId, null));
        Assert.Equal(ownerCategoryId, Invoke<Guid?>("GetEffectiveCategoryId", privateTodo, viewerId, null));

        Assert.True(Invoke<bool>("HasSharedAudience", sharedTodo));
        Assert.True(Invoke<bool>("IsSharedWithViewer", sharedTodo, viewerId));
        Assert.False(Invoke<bool>("IsSharedWithViewer", sharedTodo, ownerId));
        Assert.True(Invoke<bool>("GetEffectiveHidden", sharedTodo, ownerId, preference));
        Assert.True(Invoke<bool>("GetEffectiveHidden", sharedTodo, viewerId, preference));
        Assert.False(Invoke<bool>("GetEffectiveHidden", sharedTodo, viewerId, null));
        Assert.Equal(ownerCategoryId, Invoke<Guid?>("GetEffectiveCategoryId", sharedTodo, ownerId, preference));
        Assert.Equal(viewerCategoryId, Invoke<Guid?>("GetEffectiveCategoryId", sharedTodo, viewerId, preference));
        Assert.Null(Invoke<Guid?>("GetEffectiveCategoryId", sharedTodo, viewerId, null));
    }

    private static T Invoke<T>(string methodName, params object?[] args)
    {
        var resolver = typeof(Planora.Todo.Application.DependencyInjection)
            .Assembly
            .GetType("Planora.Todo.Application.Features.Todos.TodoViewerStateResolver")
            ?? throw new InvalidOperationException("TodoViewerStateResolver type was not found.");
        var method = resolver.GetMethod(
                methodName,
                System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
            ?? throw new InvalidOperationException($"{methodName} method was not found.");

        return (T)method.Invoke(null, args)!;
    }
}

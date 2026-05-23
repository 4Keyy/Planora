using Planora.Todo.Application.Features.Todos;
using Planora.Todo.Domain.Entities;

namespace Planora.UnitTests.Services.TodoApi.Domain;

/// <summary>
/// Direct tests for the hidden-shared-todo visibility helpers. These pin down
/// the exact branches of the security-critical redaction logic — each test
/// here was added to kill a mutant that survived Stryker mutation testing.
/// </summary>
public sealed class HiddenTodoVisibilityTests
{
    private static TodoItem Shared(Guid owner, params Guid[] recipients) =>
        TodoItem.Create(owner, "Shared", categoryId: Guid.NewGuid(), sharedWithUserIds: recipients);

    private static TodoItem Private(Guid owner) =>
        TodoItem.Create(owner, "Private", categoryId: Guid.NewGuid());

    // --- HiddenTodoDtoFactory.ShouldMask ---

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ShouldMask_OwnerViewingOwnHiddenSharedTodo_IsMasked()
    {
        var owner = Guid.NewGuid();
        var todo = Shared(owner, Guid.NewGuid());

        // Owner of a hidden todo that has a shared audience must still be masked.
        Assert.True(HiddenTodoDtoFactory.ShouldMask(todo, owner, effectiveHidden: true));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ShouldMask_OwnerViewingOwnHiddenPrivateTodo_IsNotMasked()
    {
        var owner = Guid.NewGuid();

        // Owner of a hidden private todo (no shared audience) sees it unmasked.
        Assert.False(HiddenTodoDtoFactory.ShouldMask(Private(owner), owner, effectiveHidden: true));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ShouldMask_NonOwnerOfHiddenTodo_IsMasked()
    {
        var owner = Guid.NewGuid();
        var stranger = Guid.NewGuid();

        Assert.True(HiddenTodoDtoFactory.ShouldMask(Private(owner), stranger, effectiveHidden: true));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void ShouldMask_WhenNotEffectiveHidden_IsNeverMasked()
    {
        var owner = Guid.NewGuid();
        var viewer = Guid.NewGuid();
        var todo = Shared(owner, viewer);

        Assert.False(HiddenTodoDtoFactory.ShouldMask(todo, viewer, effectiveHidden: false));
        Assert.False(HiddenTodoDtoFactory.ShouldMask(todo, owner, effectiveHidden: false));
    }

    // --- HiddenTodoDtoFactory.CreateMasked ---

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void CreateMasked_ForOwner_PreservesOwnerUserId()
    {
        var owner = Guid.NewGuid();
        var todo = Private(owner);

        var dto = HiddenTodoDtoFactory.CreateMasked(todo, owner, viewerCategoryId: null, viewerCategory: null);

        Assert.Equal(owner, dto.UserId);
        Assert.True(dto.Hidden);
        Assert.Equal("Hidden task", dto.Title);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void CreateMasked_ForNonOwner_RedactsOwnerUserId()
    {
        var owner = Guid.NewGuid();
        var stranger = Guid.NewGuid();
        var todo = Private(owner);

        var dto = HiddenTodoDtoFactory.CreateMasked(todo, stranger, viewerCategoryId: null, viewerCategory: null);

        Assert.Equal(Guid.Empty, dto.UserId);
    }

    // --- TodoViewerStateResolver.IsSharedWithViewer ---

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void IsSharedWithViewer_Stranger_IsFalse()
    {
        var owner = Guid.NewGuid();
        var viewer = Guid.NewGuid();
        var stranger = Guid.NewGuid();
        var todo = Shared(owner, viewer);

        Assert.False(TodoViewerStateResolver.IsSharedWithViewer(todo, stranger));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void IsSharedWithViewer_MultiRecipientShare_IsTrueForEachRecipient()
    {
        var owner = Guid.NewGuid();
        var viewer = Guid.NewGuid();
        var other = Guid.NewGuid();
        var todo = Shared(owner, viewer, other);

        Assert.True(TodoViewerStateResolver.IsSharedWithViewer(todo, viewer));
        Assert.True(TodoViewerStateResolver.IsSharedWithViewer(todo, other));
        Assert.False(TodoViewerStateResolver.IsSharedWithViewer(todo, owner));
    }

    // --- TodoViewerStateResolver.GetEffectiveHidden ---

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void GetEffectiveHidden_OwnerOfGloballyHiddenSharedTodo_IsHidden_EvenWithoutPreference()
    {
        var owner = Guid.NewGuid();
        var viewer = Guid.NewGuid();
        var todo = Shared(owner, viewer);
        todo.SetHidden(true, owner); // legacy global hide

        // The owner branch ORs in todo.Hidden, so the owner still sees it hidden.
        Assert.True(TodoViewerStateResolver.GetEffectiveHidden(todo, owner, preference: null));

        // A non-owner with no viewer preference does NOT inherit the legacy global hide.
        Assert.False(TodoViewerStateResolver.GetEffectiveHidden(todo, viewer, preference: null));
    }
}

using Planora.Category.Domain.Enums;
using CategoryEntity = Planora.Category.Domain.Entities.Category;
using CategoryDescription = Planora.Category.Domain.ValueObjects.CategoryDescription;
using CategoryName = Planora.Category.Domain.ValueObjects.CategoryName;

namespace Planora.UnitTests.Services.CategoryApi.Domain;

public class CategoryDomainTests
{
    [Fact]
    public void Create_ShouldInitializeCategoryForOwner()
    {
        var userId = Guid.NewGuid();
        var parentId = Guid.NewGuid();

        var category = CategoryEntity.Create(
            userId,
            "Work",
            "Tasks related to work",
            "#007BFF",
            "briefcase",
            3,
            parentId);

        Assert.Equal(userId, category.UserId);
        Assert.Equal("Work", category.Name);
        Assert.Equal("Tasks related to work", category.Description);
        Assert.Equal("#007BFF", category.Color);
        Assert.Equal("briefcase", category.Icon);
        Assert.Equal(3, category.Order);
        Assert.Equal(parentId, category.ParentCategoryId);
        Assert.False(category.IsArchived);
        Assert.NotNull(category.UpdatedAt);
        Assert.Equal(userId, category.UpdatedBy);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Create_ShouldRejectEmptyNames(string name)
    {
        Assert.Throws<ArgumentException>(() =>
            CategoryEntity.Create(Guid.NewGuid(), name, null, "#007BFF", null, 0));
    }

    [Fact]
    public void Create_ShouldRejectLongNamesAndInvalidColors()
    {
        Assert.Throws<ArgumentException>(() =>
            CategoryEntity.Create(Guid.NewGuid(), new string('x', 101), null, "#007BFF", null, 0));
        Assert.Throws<ArgumentException>(() =>
            CategoryEntity.Create(Guid.NewGuid(), "Work", null, "", null, 0));
        Assert.Throws<ArgumentException>(() =>
            CategoryEntity.Create(Guid.NewGuid(), "Work", null, "blue", null, 0));
        Assert.Throws<ArgumentException>(() =>
            CategoryEntity.Create(Guid.NewGuid(), "Work", null, "#GGGGGG", null, 0));
    }

    [Fact]
    public void UpdateMethods_ShouldValidateAndMutateCategory()
    {
        var ownerId = Guid.NewGuid();
        var category = CategoryEntity.Create(ownerId, "Work", null, "#007BFF", null, 0);

        category.UpdateName("Personal");
        category.UpdateDescription("Private tasks");
        category.UpdateAppearance("#28A745", "home");
        category.SetDisplayOrder(2);
        category.Update("Fitness", "Health tasks", "#DC3545", "activity", 5);

        Assert.Equal("Fitness", category.Name);
        Assert.Equal("Health tasks", category.Description);
        Assert.Equal("#DC3545", category.Color);
        Assert.Equal("activity", category.Icon);
        Assert.Equal(5, category.Order);
        Assert.Throws<ArgumentException>(() => category.SetDisplayOrder(-1));
    }

    [Fact]
    public void ArchiveUnarchiveAndDelete_ShouldTrackOwnerAndDomainEvent()
    {
        var ownerId = Guid.NewGuid();
        var category = CategoryEntity.Create(ownerId, "Work", null, "#007BFF", null, 0);

        category.Archive();
        Assert.True(category.IsArchived);

        category.Unarchive();
        Assert.False(category.IsArchived);

        Assert.Throws<UnauthorizedAccessException>(() => category.Delete(Guid.NewGuid()));

        category.Delete(ownerId);

        Assert.True(category.IsDeleted);
        Assert.Equal(ownerId, category.DeletedBy);
        Assert.Contains(category.DomainEvents, e => e.GetType().Name == "CategoryDeletedDomainEvent");
    }

    [Fact]
    public void CategoryValueObjects_ShouldTrimValidValuesAndReturnFailuresForInvalidValues()
    {
        var name = CategoryName.Create("  Work  ");
        var sameName = CategoryName.Create("Work");
        var description = CategoryDescription.Create("  Description  ");
        var sameDescription = CategoryDescription.Create("Description");

        Assert.True(name.IsSuccess);
        Assert.Equal("Work", name.Value!.Value);
        Assert.Equal(name.Value, sameName.Value);
        Assert.True(description.IsSuccess);
        Assert.Equal("Description", description.Value!.Value);
        Assert.Equal(description.Value, sameDescription.Value);

        Assert.True(CategoryName.Create("").IsFailure);
        Assert.True(CategoryName.Create(new string('x', 101)).IsFailure);
        Assert.True(CategoryDescription.Create("").IsFailure);
        Assert.True(CategoryDescription.Create(new string('x', 501)).IsFailure);

        var nameEfConstructor = typeof(CategoryName).GetConstructor(
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic,
            binder: null,
            Type.EmptyTypes,
            modifiers: null);
        var descriptionEfConstructor = typeof(CategoryDescription).GetConstructor(
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic,
            binder: null,
            Type.EmptyTypes,
            modifiers: null);
        Assert.Equal(string.Empty, Assert.IsType<CategoryName>(nameEfConstructor!.Invoke(null)).Value);
        Assert.Equal(string.Empty, Assert.IsType<CategoryDescription>(descriptionEfConstructor!.Invoke(null)).Value);
    }

    [Fact]
    public void CategoryColors_ShouldAcceptPredefinedAndHexColors()
    {
        Assert.True(CategoryColors.IsValid("#007BFF"));
        Assert.True(CategoryColors.IsValid("#abcdef"));
        Assert.False(CategoryColors.IsValid(""));
        Assert.False(CategoryColors.IsValid("blue"));
        Assert.False(CategoryColors.IsValid("#12345"));
    }
}

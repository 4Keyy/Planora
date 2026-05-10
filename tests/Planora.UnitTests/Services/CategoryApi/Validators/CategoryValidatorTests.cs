using Planora.Category.Application.Features.Categories.Commands.CreateCategory;
using Planora.Category.Application.Features.Categories.Commands.UpdateCategory;

namespace Planora.UnitTests.Services.CategoryApi.Validators;

public class CategoryValidatorTests
{
    [Fact]
    public void CreateCategoryValidator_ShouldAcceptValidCategory()
    {
        var validator = new CreateCategoryCommandValidator();

        var result = validator.Validate(new CreateCategoryCommand(
            UserId: Guid.NewGuid(),
            Name: "Work",
            Description: "Work tasks",
            Color: "#007BFF",
            Icon: "Briefcase",
            DisplayOrder: 1));

        Assert.True(result.IsValid);
    }

    [Fact]
    public void CreateCategoryValidator_ShouldRejectInvalidNameDescriptionAndColor()
    {
        var validator = new CreateCategoryCommandValidator();

        var result = validator.Validate(new CreateCategoryCommand(
            UserId: Guid.NewGuid(),
            Name: "",
            Description: new string('d', 501),
            Color: "blue",
            Icon: null));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateCategoryCommand.Name));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateCategoryCommand.Description));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateCategoryCommand.Color));
    }

    [Fact]
    public void UpdateCategoryValidator_ShouldRequireIdAndValidateOptionalFields()
    {
        var validator = new UpdateCategoryCommandValidator();

        var result = validator.Validate(new UpdateCategoryCommand(
            CategoryId: Guid.Empty,
            Name: new string('n', 51),
            Description: new string('d', 501),
            Color: "blue"));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateCategoryCommand.CategoryId));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateCategoryCommand.Name));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateCategoryCommand.Description));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateCategoryCommand.Color));
    }

    [Fact]
    public void UpdateCategoryValidator_ShouldAcceptPartialPatch()
    {
        var validator = new UpdateCategoryCommandValidator();

        var result = validator.Validate(new UpdateCategoryCommand(
            CategoryId: Guid.NewGuid(),
            Name: "Updated",
            Color: "#28A745"));

        Assert.True(result.IsValid);
    }
}

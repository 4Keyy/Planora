using Planora.Todo.Application.Features.Todos.Commands.CreateTodo;
using Planora.Todo.Application.Features.Todos.Commands.UpdateTodo;
using Planora.Todo.Domain.Enums;

namespace Planora.UnitTests.Services.TodoApi.Validators;

public class TodoValidatorTests
{
    [Fact]
    public void CreateTodoValidator_ShouldAcceptValidPastAndFutureDates_WhenExpectedIsNotAfterDue()
    {
        var validator = new CreateTodoCommandValidator();

        var result = validator.Validate(new CreateTodoCommand(
            UserId: Guid.NewGuid(),
            Title: "Plan",
            Description: "Details",
            CategoryId: Guid.NewGuid(),
            DueDate: DateTime.UtcNow.AddDays(-1),
            ExpectedDate: DateTime.UtcNow.AddDays(-2),
            Priority: TodoPriority.High));

        Assert.True(result.IsValid);
    }

    [Fact]
    public void CreateTodoValidator_ShouldRejectTitleDescriptionAndInvalidDateWindow()
    {
        var validator = new CreateTodoCommandValidator();

        var result = validator.Validate(new CreateTodoCommand(
            UserId: Guid.NewGuid(),
            Title: "",
            Description: new string('d', 5001),
            CategoryId: null,
            DueDate: new DateTime(2026, 5, 1),
            ExpectedDate: new DateTime(2026, 5, 2)));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateTodoCommand.Title));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(CreateTodoCommand.Description));
        Assert.Contains(result.Errors, error => error.ErrorMessage == "Expected date cannot be after due date");
    }

    [Fact]
    public void UpdateTodoValidator_ShouldRequireIdAndValidateOptionalFields()
    {
        var validator = new UpdateTodoCommandValidator();

        var result = validator.Validate(new UpdateTodoCommand(
            TodoId: Guid.Empty,
            Title: new string('t', 201),
            Description: new string('d', 5001),
            DueDate: new DateTime(2026, 5, 1),
            ExpectedDate: new DateTime(2026, 5, 2)));

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateTodoCommand.TodoId));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateTodoCommand.Title));
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(UpdateTodoCommand.Description));
        Assert.Contains(result.Errors, error => error.ErrorMessage == "Expected date cannot be after due date");
    }

    [Fact]
    public void UpdateTodoValidator_ShouldAcceptPartialMetadataPatch()
    {
        var validator = new UpdateTodoCommandValidator();

        var result = validator.Validate(new UpdateTodoCommand(
            TodoId: Guid.NewGuid(),
            Title: "Updated title",
            Priority: TodoPriority.Urgent,
            IsPublic: true));

        Assert.True(result.IsValid);
    }
}

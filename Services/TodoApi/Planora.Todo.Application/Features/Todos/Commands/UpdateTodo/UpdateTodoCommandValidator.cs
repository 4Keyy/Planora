using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Application.Features.Todos.Commands.UpdateTodo
{
    public sealed class UpdateTodoCommandValidator : AbstractValidator<UpdateTodoCommand>
    {
        public UpdateTodoCommandValidator()
        {
            RuleFor(x => x.TodoId)
                .NotEmpty().WithMessage("Todo ID is required");

            RuleFor(x => x.Title)
                .MaximumLength(200).WithMessage("Title cannot exceed 200 characters")
                .When(x => !string.IsNullOrEmpty(x.Title));

            RuleFor(x => x.Description)
                .MaximumLength(5000).WithMessage("Description cannot exceed 5000 characters")
                .When(x => !string.IsNullOrEmpty(x.Description));

            // Date validations removed - allow any dates including past dates
            // RuleFor(x => x.DueDate)
            //     .GreaterThan(DateTime.UtcNow).WithMessage("Due date must be in the future")
            //     .When(x => x.DueDate.HasValue);

            // RuleFor(x => x.ExpectedDate)
            //     .GreaterThan(DateTime.UtcNow).WithMessage("Expected date must be in the future")
            //     .When(x => x.ExpectedDate.HasValue);

            // CRITICAL: ExpectedDate cannot be after DueDate
            RuleFor(x => x)
                .Must(x => !x.ExpectedDate.HasValue || !x.DueDate.HasValue || x.ExpectedDate.Value <= x.DueDate.Value)
                .WithMessage("Expected date cannot be after due date")
                .When(x => x.ExpectedDate.HasValue && x.DueDate.HasValue);
        }
    }
}

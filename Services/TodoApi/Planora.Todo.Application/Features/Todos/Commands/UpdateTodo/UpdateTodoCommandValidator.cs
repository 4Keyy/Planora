using Planora.Todo.Domain.Enums;

namespace Planora.Todo.Application.Features.Todos.Commands.UpdateTodo
{
    public sealed class UpdateTodoCommandValidator : AbstractValidator<UpdateTodoCommand>
    {
        public UpdateTodoCommandValidator()
        {
            RuleFor(x => x.TodoId)
                .NotEmpty().WithMessage("Todo ID is required");

            // This command edits both regular tasks and subtasks (a subtask rename also goes
            // through here), so the cap matches the larger 1500-char subtask-title allowance and
            // the widened TodoItems.Title column. Regular-task titles are kept to 200 chars by the
            // create validator and the UI input limits.
            RuleFor(x => x.Title)
                .MaximumLength(1500).WithMessage("Title cannot exceed 1500 characters")
                .When(x => !string.IsNullOrEmpty(x.Title));

            // See CreateTodoCommandValidator for the rationale — must match
            // TodoItemConfiguration.HasMaxLength(2000) for the Description column.
            RuleFor(x => x.Description)
                .MaximumLength(2000).WithMessage("Description cannot exceed 2000 characters")
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

            // Estimated-completion interval: a start bound requires an end bound (DueDate)…
            RuleFor(x => x)
                .Must(x => x.DueDate.HasValue)
                .WithMessage("A due-date range start requires an end date")
                .When(x => x.DueDateStart.HasValue);

            // …and the start can never be later than the end.
            RuleFor(x => x)
                .Must(x => !x.DueDate.HasValue || x.DueDateStart!.Value <= x.DueDate.Value)
                .WithMessage("Due-date range start cannot be after the end date")
                .When(x => x.DueDateStart.HasValue);
        }
    }
}

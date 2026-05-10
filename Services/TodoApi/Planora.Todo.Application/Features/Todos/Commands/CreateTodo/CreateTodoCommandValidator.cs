namespace Planora.Todo.Application.Features.Todos.Commands.CreateTodo
{
    public sealed class CreateTodoCommandValidator : AbstractValidator<CreateTodoCommand>
    {
        public CreateTodoCommandValidator()
        {
            RuleFor(x => x.Title)
                .NotEmpty().WithMessage("Title is required")
                .MaximumLength(200).WithMessage("Title cannot exceed 200 characters");

            RuleFor(x => x.Description)
                .MaximumLength(5000).WithMessage("Description cannot exceed 5000 characters")
                .When(x => !string.IsNullOrEmpty(x.Description));

            // DueDate validation removed - allow past dates for flexibility
            // ExpectedDate validation removed - allow past dates for flexibility

            // CRITICAL: ExpectedDate cannot be after DueDate
            RuleFor(x => x)
                .Must(x => !x.ExpectedDate.HasValue || !x.DueDate.HasValue || x.ExpectedDate.Value <= x.DueDate.Value)
                .WithMessage("Expected date cannot be after due date")
                .When(x => x.ExpectedDate.HasValue && x.DueDate.HasValue);

            RuleFor(x => x.RequiredWorkers)
                .GreaterThanOrEqualTo(1).WithMessage("RequiredWorkers must be at least 1")
                .When(x => x.RequiredWorkers.HasValue);
        }
    }
}

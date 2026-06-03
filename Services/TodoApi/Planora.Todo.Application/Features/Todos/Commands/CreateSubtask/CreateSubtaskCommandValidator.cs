namespace Planora.Todo.Application.Features.Todos.Commands.CreateSubtask
{
    public sealed class CreateSubtaskCommandValidator : AbstractValidator<CreateSubtaskCommand>
    {
        public CreateSubtaskCommandValidator()
        {
            RuleFor(x => x.ParentTodoId)
                .NotEmpty().WithMessage("Parent task is required");

            // A subtask's whole content lives in its title (it has no separate body), so it gets a
            // generous 1500-character allowance — far larger than a regular task's 200-char title.
            RuleFor(x => x.Title)
                .NotEmpty().WithMessage("Title is required")
                .MaximumLength(1500).WithMessage("Title cannot exceed 1500 characters");

            // Aligned with the TodoItem.Description column (varchar(2000)).
            RuleFor(x => x.Description)
                .MaximumLength(2000).WithMessage("Description cannot exceed 2000 characters")
                .When(x => !string.IsNullOrEmpty(x.Description));
        }
    }
}

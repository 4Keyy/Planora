namespace Planora.Todo.Application.Features.Todos.Commands.CreateSubtask
{
    public sealed class CreateSubtaskCommandValidator : AbstractValidator<CreateSubtaskCommand>
    {
        public CreateSubtaskCommandValidator()
        {
            RuleFor(x => x.ParentTodoId)
                .NotEmpty().WithMessage("Parent task is required");

            RuleFor(x => x.Title)
                .NotEmpty().WithMessage("Title is required")
                .MaximumLength(200).WithMessage("Title cannot exceed 200 characters");

            // Aligned with the TodoItem.Description column (varchar(2000)).
            RuleFor(x => x.Description)
                .MaximumLength(2000).WithMessage("Description cannot exceed 2000 characters")
                .When(x => !string.IsNullOrEmpty(x.Description));
        }
    }
}

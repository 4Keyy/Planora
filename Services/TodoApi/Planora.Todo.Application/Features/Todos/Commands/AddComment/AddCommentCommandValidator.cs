namespace Planora.Todo.Application.Features.Todos.Commands.AddComment
{
    public sealed class AddCommentCommandValidator : AbstractValidator<AddCommentCommand>
    {
        public AddCommentCommandValidator()
        {
            RuleFor(x => x.TodoId).NotEmpty().WithMessage("TodoId is required");
            RuleFor(x => x.Content)
                .NotEmpty().WithMessage("Content cannot be empty")
                .MaximumLength(2000).WithMessage("Content cannot exceed 2000 characters");
        }
    }
}

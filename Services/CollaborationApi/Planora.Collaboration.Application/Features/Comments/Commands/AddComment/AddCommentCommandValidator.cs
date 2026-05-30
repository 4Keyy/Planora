namespace Planora.Collaboration.Application.Features.Comments.Commands.AddComment
{
    public sealed class AddCommentCommandValidator : AbstractValidator<AddCommentCommand>
    {
        public AddCommentCommandValidator()
        {
            RuleFor(x => x.TaskId).NotEmpty().WithMessage("TaskId is required");
            RuleFor(x => x.Content)
                .NotEmpty().WithMessage("Content cannot be empty")
                .MaximumLength(2000).WithMessage("Content cannot exceed 2000 characters");
        }
    }
}

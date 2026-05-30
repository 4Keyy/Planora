namespace Planora.Collaboration.Application.Features.Comments.Commands.AddGenesisComment
{
    public sealed class AddGenesisCommentCommandValidator : AbstractValidator<AddGenesisCommentCommand>
    {
        public AddGenesisCommentCommandValidator()
        {
            RuleFor(x => x.TaskId).NotEmpty().WithMessage("TaskId is required");
            RuleFor(x => x.Content)
                .NotEmpty().WithMessage("Description cannot be empty")
                .MaximumLength(5000).WithMessage("Description cannot exceed 5000 characters");
        }
    }
}

namespace Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment
{
    public sealed class UpdateCommentCommandValidator : AbstractValidator<UpdateCommentCommand>
    {
        public UpdateCommentCommandValidator()
        {
            RuleFor(x => x.TaskId).NotEmpty().WithMessage("TaskId is required");
            RuleFor(x => x.CommentId).NotEmpty().WithMessage("CommentId is required");
            RuleFor(x => x.Content)
                .NotEmpty().WithMessage("Content cannot be empty")
                .MaximumLength(2000).WithMessage("Content cannot exceed 2000 characters");
        }
    }
}

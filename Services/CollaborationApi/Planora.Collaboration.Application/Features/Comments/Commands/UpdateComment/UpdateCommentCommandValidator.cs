namespace Planora.Collaboration.Application.Features.Comments.Commands.UpdateComment
{
    public sealed class UpdateCommentCommandValidator : AbstractValidator<UpdateCommentCommand>
    {
        public UpdateCommentCommandValidator()
        {
            RuleFor(x => x.TaskId).NotEmpty().WithMessage("TaskId is required");
            RuleFor(x => x.CommentId).NotEmpty().WithMessage("CommentId is required");
            // 5000 is the upper bound across both comment kinds (genesis allows 5000,
            // a regular comment 2000). The validator cannot see the kind, so it enforces
            // only the ceiling; the domain (Comment.UpdateContent / UpdateGenesisContent)
            // applies the exact per-kind limit and surfaces a 400 if exceeded.
            RuleFor(x => x.Content)
                .NotEmpty().WithMessage("Content cannot be empty")
                .MaximumLength(5000).WithMessage("Content cannot exceed 5000 characters");
        }
    }
}

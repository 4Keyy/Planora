namespace Planora.Collaboration.Application.Features.Comments.Commands.AddComment
{
    public sealed class AddCommentCommandValidator : AbstractValidator<AddCommentCommand>
    {
        private static readonly string[] AllowedReplyTypes = { "comment", "subtask" };

        public AddCommentCommandValidator()
        {
            RuleFor(x => x.TaskId).NotEmpty().WithMessage("TaskId is required");
            RuleFor(x => x.Content)
                .NotEmpty().WithMessage("Content cannot be empty")
                .MaximumLength(2000).WithMessage("Content cannot exceed 2000 characters");

            // The reply reference is all-or-nothing: a type without an id (or vice versa)
            // is a malformed request, not "a plain comment".
            RuleFor(x => x.ReplyToType)
                .Must(t => t is null || AllowedReplyTypes.Contains(t.ToLowerInvariant()))
                .WithMessage("ReplyToType must be 'comment' or 'subtask'");

            RuleFor(x => x.ReplyToId)
                .NotEmpty()
                .When(x => x.ReplyToType is not null)
                .WithMessage("ReplyToId is required when ReplyToType is set");

            RuleFor(x => x.ReplyToType)
                .NotEmpty()
                .When(x => x.ReplyToId.HasValue)
                .WithMessage("ReplyToType is required when ReplyToId is set");
        }
    }
}

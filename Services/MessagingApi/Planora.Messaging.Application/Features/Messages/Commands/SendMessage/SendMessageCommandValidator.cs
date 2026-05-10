using FluentValidation;

namespace Planora.Messaging.Application.Features.Messages.Commands.SendMessage;

public class SendMessageCommandValidator : AbstractValidator<SendMessageCommand>
{
    public SendMessageCommandValidator()
    {
        RuleFor(x => x.RecipientId)
            .NotEmpty().WithMessage("RecipientId is required.");

        RuleFor(x => x.Subject)
            .NotEmpty().WithMessage("Subject is required.")
            .MaximumLength(200).WithMessage("Subject must not exceed 200 characters.");

        RuleFor(x => x.Body)
            .NotEmpty().WithMessage("Body is required.")
            .MaximumLength(10000).WithMessage("Body must not exceed 10000 characters.");

        // CRITICAL: Cannot send message to self
        RuleFor(x => x)
            .Must(x => !x.SenderId.HasValue || x.SenderId.Value != x.RecipientId)
            .WithMessage("Cannot send message to yourself")
            .When(x => x.SenderId.HasValue);
    }
}

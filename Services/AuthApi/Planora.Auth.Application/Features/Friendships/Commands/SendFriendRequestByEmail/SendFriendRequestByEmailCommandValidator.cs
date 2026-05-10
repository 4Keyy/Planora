namespace Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequestByEmail;

public sealed class SendFriendRequestByEmailCommandValidator : AbstractValidator<SendFriendRequestByEmailCommand>
{
    public SendFriendRequestByEmailCommandValidator()
    {
        RuleFor(x => x.Email)
            .NotEmpty().WithMessage("Email is required")
            .EmailAddress().WithMessage("Email format is invalid")
            .MaximumLength(255).WithMessage("Email cannot be longer than 255 characters");
    }
}

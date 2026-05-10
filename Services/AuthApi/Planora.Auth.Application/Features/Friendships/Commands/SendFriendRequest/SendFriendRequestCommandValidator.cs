namespace Planora.Auth.Application.Features.Friendships.Commands.SendFriendRequest
{
    public sealed class SendFriendRequestCommandValidator : AbstractValidator<SendFriendRequestCommand>
    {
        public SendFriendRequestCommandValidator()
        {
            RuleFor(x => x.FriendId)
                .NotEmpty().WithMessage("Friend ID is required");
        }
    }
}


namespace Planora.Messaging.Application.Features.Messages.Commands.SendMessage
{
    public sealed record SendMessageCommand(
        Guid? SenderId,
        string Subject,
        string Body,
        Guid RecipientId) : ICommand<SendMessageResponse>;

    public sealed record SendMessageResponse(
        Guid MessageId,
        DateTime CreatedAt);
}

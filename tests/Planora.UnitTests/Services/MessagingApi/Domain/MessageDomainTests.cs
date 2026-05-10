using Planora.Messaging.Domain.Entities;

namespace Planora.UnitTests.Services.MessagingApi.Domain;

public sealed class MessageDomainTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void Message_ShouldValidateParticipantsAndTrackReadArchiveState()
    {
        var senderId = Guid.NewGuid();
        var recipientId = Guid.NewGuid();
        var message = new Message("Subject", "Body", senderId, recipientId);

        Assert.Equal("Subject", message.Subject);
        Assert.Equal("Body", message.Body);
        Assert.Equal(senderId, message.SenderId);
        Assert.Equal(recipientId, message.RecipientId);
        Assert.Equal("[]", message.AttachmentUrls);

        message.MarkAsRead();
        var firstReadAt = message.ReadAt;
        message.MarkAsRead();
        Assert.Equal(firstReadAt, message.ReadAt);

        message.Archive();
        Assert.True(message.IsArchived);
        message.Unarchive();
        Assert.False(message.IsArchived);

        Assert.Throws<ArgumentException>(() => new Message("", "Body", senderId, recipientId));
        Assert.Throws<ArgumentException>(() => new Message("Subject", "", senderId, recipientId));
        Assert.Throws<ArgumentException>(() => new Message("Subject", "Body", Guid.Empty, recipientId));
        Assert.Throws<ArgumentException>(() => new Message("Subject", "Body", senderId, Guid.Empty));
        Assert.Throws<InvalidOperationException>(() => new Message("Subject", "Body", senderId, senderId));

        var efConstructor = typeof(Message).GetConstructor(
            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic,
            binder: null,
            Type.EmptyTypes,
            modifiers: null);
        var efMessage = Assert.IsType<Message>(efConstructor!.Invoke(null));
        Assert.Equal("[]", efMessage.AttachmentUrls);
    }
}

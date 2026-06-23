using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Application.Persistence;
using Planora.Messaging.Application.Features.Messages.Commands.SendMessage;
using Planora.Messaging.Application.Services;
using Planora.Messaging.Domain;
using Planora.Messaging.Domain.Entities;
using Microsoft.Extensions.Logging;
using Moq;
using Xunit;

namespace Planora.UnitTests.Services.MessagingApi.Handlers;

public class SendMessageHandlerTests
{
    private readonly Mock<IMessageRepository> _messageRepositoryMock = new();
    private readonly Mock<ICurrentUserService> _currentUserServiceMock = new();
    private readonly Mock<IFriendshipService> _friendshipServiceMock = new();
    private readonly Mock<IOutboxRepository> _outboxMock = new();
    private readonly SendMessageHandler _handler;

    public SendMessageHandlerTests()
    {
        _messageRepositoryMock
            .Setup(x => x.AddAsync(It.IsAny<Message>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Message message, CancellationToken _) => message);
        _outboxMock
            .Setup(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        _handler = new SendMessageHandler(
            _messageRepositoryMock.Object,
            Mock.Of<ILogger<SendMessageHandler>>(),
            _currentUserServiceMock.Object,
            _friendshipServiceMock.Object,
            _outboxMock.Object);
    }

    [Fact]
    public async Task Handle_ShouldSaveAndEnqueueNotificationToOutbox_WhenUsersAreFriends()
    {
        var senderId = Guid.NewGuid();
        var recipientId = Guid.NewGuid();
        var command = new SendMessageCommand(null, "Planning", "Meet at noon", recipientId);

        _currentUserServiceMock.Setup(x => x.UserId).Returns(senderId);
        _friendshipServiceMock
            .Setup(x => x.AreFriendsAsync(senderId, recipientId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var response = await _handler.Handle(command, CancellationToken.None);

        Assert.NotEqual(Guid.Empty, response.MessageId);
        _messageRepositoryMock.Verify(
            x => x.AddAsync(
                It.Is<Message>(m =>
                    m.SenderId == senderId &&
                    m.RecipientId == recipientId &&
                    m.Subject == command.Subject &&
                    m.Body == command.Body),
                It.IsAny<CancellationToken>()),
            Times.Once);
        // The handler no longer publishes straight to the broker nor calls SaveChanges itself: the
        // notification is enqueued into the outbox, whose AddAsync commits the message + outbox row.
        _messageRepositoryMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        _outboxMock.Verify(
            x => x.AddAsync(
                It.Is<OutboxMessage>(m =>
                    m.Type.Contains("NotificationEvent") &&
                    m.Content.Contains(recipientId.ToString()) &&
                    m.Content.Contains("MessageReceived")),
                It.IsAny<CancellationToken>()),
            Times.Once);
    }

    [Fact]
    public async Task Handle_ShouldRejectAndNotSave_WhenUsersAreNotFriends()
    {
        var senderId = Guid.NewGuid();
        var recipientId = Guid.NewGuid();
        var command = new SendMessageCommand(null, "Planning", "Meet at noon", recipientId);

        _currentUserServiceMock.Setup(x => x.UserId).Returns(senderId);
        _friendshipServiceMock
            .Setup(x => x.AreFriendsAsync(senderId, recipientId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(false);

        await Assert.ThrowsAsync<ForbiddenException>(() => _handler.Handle(command, CancellationToken.None));

        _messageRepositoryMock.Verify(
            x => x.AddAsync(It.IsAny<Message>(), It.IsAny<CancellationToken>()),
            Times.Never);
        _messageRepositoryMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
        _outboxMock.Verify(
            x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    [Fact]
    public async Task Handle_ShouldRejectSenderMismatch_BeforeFriendshipCheck()
    {
        var currentUserId = Guid.NewGuid();
        var spoofedSenderId = Guid.NewGuid();
        var recipientId = Guid.NewGuid();
        var command = new SendMessageCommand(spoofedSenderId, "Planning", "Meet at noon", recipientId);

        _currentUserServiceMock.Setup(x => x.UserId).Returns(currentUserId);

        await Assert.ThrowsAsync<ForbiddenException>(() => _handler.Handle(command, CancellationToken.None));

        _friendshipServiceMock.Verify(
            x => x.AreFriendsAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()),
            Times.Never);
        _messageRepositoryMock.Verify(
            x => x.AddAsync(It.IsAny<Message>(), It.IsAny<CancellationToken>()),
            Times.Never);
        _outboxMock.Verify(
            x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}

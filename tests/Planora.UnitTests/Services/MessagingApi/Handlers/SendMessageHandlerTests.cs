using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Infrastructure.Messaging;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using Planora.BuildingBlocks.Infrastructure.Persistence;
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
    private readonly Mock<IEventBus> _eventBusMock = new();
    private readonly SendMessageHandler _handler;

    public SendMessageHandlerTests()
    {
        _messageRepositoryMock
            .Setup(x => x.AddAsync(It.IsAny<Message>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Message message, CancellationToken _) => message);
        _messageRepositoryMock
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(1);
        _eventBusMock
            .Setup(x => x.PublishAsync(It.IsAny<NotificationEvent>(), It.IsAny<CancellationToken>()))
            .Returns(Task.CompletedTask);

        _handler = new SendMessageHandler(
            _messageRepositoryMock.Object,
            Mock.Of<ILogger<SendMessageHandler>>(),
            _currentUserServiceMock.Object,
            _friendshipServiceMock.Object,
            _eventBusMock.Object);
    }

    [Fact]
    public async Task Handle_ShouldSaveAndPublishNotification_WhenUsersAreFriends()
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
        _messageRepositoryMock.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
        _eventBusMock.Verify(
            x => x.PublishAsync(
                It.Is<NotificationEvent>(e =>
                    e.UserId == recipientId &&
                    e.Title == "New message" &&
                    e.Message == "New message: Planning" &&
                    e.Type == "MessageReceived"),
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
        _eventBusMock.Verify(
            x => x.PublishAsync(It.IsAny<NotificationEvent>(), It.IsAny<CancellationToken>()),
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
        _eventBusMock.Verify(
            x => x.PublishAsync(It.IsAny<NotificationEvent>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }
}

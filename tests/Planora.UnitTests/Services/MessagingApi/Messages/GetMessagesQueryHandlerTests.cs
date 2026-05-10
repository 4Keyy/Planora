using Planora.Messaging.Application.Features.Messages.Queries.GetMessages;
using Planora.Messaging.Domain;
using Planora.Messaging.Domain.Entities;
using Moq;
using Xunit;

namespace Planora.UnitTests.Services.MessagingApi.Messages;

public sealed class GetMessagesQueryHandlerTests
{
    [Fact]
    public async Task Handle_ShouldReturnPagedResultMetadataInCorrectOrder()
    {
        // Arrange
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var messages = new[]
        {
            new Message("Subject", "Body", userId, otherUserId)
        };

        var repository = new Mock<IMessageRepository>();
        repository
            .Setup(r => r.GetConversationPagedAsync(
                userId,
                otherUserId,
                2,
                25,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((messages, 43));

        var handler = new GetMessagesQueryHandler(repository.Object);

        // Act
        var result = await handler.Handle(
            new GetMessagesQuery(userId, otherUserId, Page: 2, PageSize: 25),
            CancellationToken.None);

        // Assert
        Assert.Single(result.Items);
        Assert.Equal(2, result.PageNumber);
        Assert.Equal(25, result.PageSize);
        Assert.Equal(43, result.TotalCount);
        Assert.Equal(2, result.TotalPages);
    }

    [Fact]
    public async Task Handle_ShouldNormalizeUnsafePaginationBeforeQueryingRepository()
    {
        // Arrange
        var userId = Guid.NewGuid();
        var otherUserId = Guid.NewGuid();
        var repository = new Mock<IMessageRepository>();
        repository
            .Setup(r => r.GetConversationPagedAsync(
                userId,
                otherUserId,
                1,
                100,
                It.IsAny<CancellationToken>()))
            .ReturnsAsync((Array.Empty<Message>(), 0));

        var handler = new GetMessagesQueryHandler(repository.Object);

        // Act
        var result = await handler.Handle(
            new GetMessagesQuery(userId, otherUserId, Page: -5, PageSize: 500),
            CancellationToken.None);

        // Assert
        Assert.Equal(1, result.PageNumber);
        Assert.Equal(100, result.PageSize);
        repository.VerifyAll();
    }
}

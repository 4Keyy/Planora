using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using Moq;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Infrastructure.IdempotentConsumer;
using Planora.BuildingBlocks.Infrastructure.Inbox;

namespace Planora.UnitTests.BuildingBlocks.IdempotentConsumer;

public class IdempotentMessageHandlerTests
{
    [Fact]
    public async Task AlreadyProcessed_DoesNotInvokeDecoratedOrInsert()
    {
        var evt = new UserDeletedIntegrationEvent(Guid.NewGuid(), "u@example.com");
        var inbox = new Mock<IInboxRepository>();
        inbox.Setup(x => x.ExistsAsync(evt.Id, It.IsAny<CancellationToken>())).ReturnsAsync(true);
        var decorated = new Mock<IIntegrationEventHandler<UserDeletedIntegrationEvent>>();

        var handler = Build(inbox, decorated);
        await handler.HandleAsync(evt, CancellationToken.None);

        decorated.Verify(x => x.HandleAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()), Times.Never);
        inbox.Verify(x => x.AddAsync(It.IsAny<InboxMessage>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task NewEvent_StoresWithEventIdAsPrimaryKeyAndProcesses()
    {
        var evt = new UserDeletedIntegrationEvent(Guid.NewGuid(), "u@example.com");
        var inbox = new Mock<IInboxRepository>();
        inbox.Setup(x => x.ExistsAsync(evt.Id, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        InboxMessage? stored = null;
        inbox.Setup(x => x.AddAsync(It.IsAny<InboxMessage>(), It.IsAny<CancellationToken>()))
            .Callback<InboxMessage, CancellationToken>((m, _) => stored = m)
            .Returns(Task.CompletedTask);
        var decorated = new Mock<IIntegrationEventHandler<UserDeletedIntegrationEvent>>();

        var handler = Build(inbox, decorated);
        await handler.HandleAsync(evt, CancellationToken.None);

        Assert.NotNull(stored);
        Assert.Equal(evt.Id, stored!.Id); // PK is the event id, so ExistsAsync can find it next time.
        decorated.Verify(x => x.HandleAsync(evt, It.IsAny<CancellationToken>()), Times.Once);
        inbox.Verify(x => x.UpdateAsync(
            It.Is<InboxMessage>(m => m.Status == InboxMessageStatus.Processed), It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ConcurrentDuplicate_InsertConflict_SkipsWithoutProcessing()
    {
        var evt = new UserDeletedIntegrationEvent(Guid.NewGuid(), "u@example.com");
        var inbox = new Mock<IInboxRepository>();
        inbox.Setup(x => x.ExistsAsync(evt.Id, It.IsAny<CancellationToken>())).ReturnsAsync(false);
        // A racing delivery already inserted the same PK between the check and this insert.
        inbox.Setup(x => x.AddAsync(It.IsAny<InboxMessage>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new DbUpdateException("duplicate key value violates unique constraint"));
        var decorated = new Mock<IIntegrationEventHandler<UserDeletedIntegrationEvent>>();

        var handler = Build(inbox, decorated);
        await handler.HandleAsync(evt, CancellationToken.None); // must not throw

        decorated.Verify(x => x.HandleAsync(It.IsAny<UserDeletedIntegrationEvent>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    private static IdempotentMessageHandler<UserDeletedIntegrationEvent> Build(
        Mock<IInboxRepository> inbox,
        Mock<IIntegrationEventHandler<UserDeletedIntegrationEvent>> decorated) =>
        new(inbox.Object, decorated.Object,
            Mock.Of<ILogger<IdempotentMessageHandler<UserDeletedIntegrationEvent>>>());
}

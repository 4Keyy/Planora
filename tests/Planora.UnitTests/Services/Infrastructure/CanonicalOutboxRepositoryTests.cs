using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Moq;

namespace Planora.UnitTests.Services.Infrastructure;

/// <summary>
/// Pins the canonical <see cref="OutboxRepository{TContext}"/> behaviour directly,
/// independent of the per-service legacy adapters. Survives the deletion of
/// <c>Auth.Infrastructure.Persistence.Repositories.OutboxRepository</c>,
/// <c>Messaging.Infrastructure.Persistence.Repositories.OutboxRepository</c>, and
/// <c>Category.Infrastructure.Persistence.Repositories.OutboxRepository</c> in the
/// release that follows Phase 2 T2.3.
/// </summary>
public sealed class CanonicalOutboxRepositoryTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task GetPendingMessagesAsync_ReturnsPendingAndRetryEligibleFailed_OrderedByOccurredOn()
    {
        using var context = CreateContext();
        var repository = new OutboxRepository<CategoryDbContext>(context);

        var oldestPending = new OutboxMessage("OldestPending", "{}", DateTime.UtcNow.AddMinutes(-30));
        var newestPending = new OutboxMessage("NewestPending", "{}", DateTime.UtcNow.AddMinutes(-5));
        var failedRetryDue = new OutboxMessage("FailedRetryDue", "{}", DateTime.UtcNow.AddMinutes(-20));
        SetProperty(failedRetryDue, nameof(OutboxMessage.Status), OutboxMessageStatus.Failed);
        SetProperty(failedRetryDue, nameof(OutboxMessage.NextRetryUtc), DateTime.UtcNow.AddMinutes(-1));
        var failedRetryFuture = new OutboxMessage("FailedRetryFuture", "{}", DateTime.UtcNow.AddMinutes(-40));
        SetProperty(failedRetryFuture, nameof(OutboxMessage.Status), OutboxMessageStatus.Failed);
        SetProperty(failedRetryFuture, nameof(OutboxMessage.NextRetryUtc), DateTime.UtcNow.AddHours(1));
        var deadLettered = new OutboxMessage("DeadLettered", "{}", DateTime.UtcNow.AddMinutes(-15));
        SetProperty(deadLettered, nameof(OutboxMessage.Status), OutboxMessageStatus.DeadLettered);

        await repository.AddAsync(oldestPending);
        context.OutboxMessages.AddRange(newestPending, failedRetryDue, failedRetryFuture, deadLettered);
        await context.SaveChangesAsync();

        var pending = await repository.GetPendingMessagesAsync(batchSize: 10);

        // Pending + Failed-with-elapsed-NextRetryUtc, ordered by OccurredOnUtc ascending.
        // Failed-with-future-NextRetryUtc is excluded; DeadLettered is terminal (INV-COMM-3a).
        Assert.Equal(
            new[] { "OldestPending", "FailedRetryDue", "NewestPending" },
            pending.Select(m => m.Type));
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task DeleteProcessedMessagesAsync_OnlyTouchesProcessedRowsOlderThanCutoff()
    {
        using var context = CreateContext();
        var repository = new OutboxRepository<CategoryDbContext>(context);

        var ancientProcessed = new OutboxMessage("AncientProcessed", "{}", DateTime.UtcNow.AddDays(-10));
        ancientProcessed.MarkAsProcessed();
        SetProperty(ancientProcessed, nameof(OutboxMessage.ProcessedOnUtc), DateTime.UtcNow.AddDays(-5));

        var recentProcessed = new OutboxMessage("RecentProcessed", "{}", DateTime.UtcNow);
        recentProcessed.MarkAsProcessed();

        var ancientPending = new OutboxMessage("AncientPending", "{}", DateTime.UtcNow.AddDays(-10));
        // Pending status — must NOT be deleted even though it's older than the cutoff.

        context.OutboxMessages.AddRange(ancientProcessed, recentProcessed, ancientPending);
        await context.SaveChangesAsync();

        await repository.DeleteProcessedMessagesAsync(DateTime.UtcNow.AddDays(-1));

        Assert.DoesNotContain(context.OutboxMessages, m => m.Type == "AncientProcessed");
        Assert.Contains(context.OutboxMessages, m => m.Type == "RecentProcessed");
        Assert.Contains(context.OutboxMessages, m => m.Type == "AncientPending");
    }

    private static CategoryDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<CategoryDbContext>()
            .UseInMemoryDatabase($"canonical-outbox-{Guid.NewGuid():N}")
            .Options;

        return new CategoryDbContext(options, Mock.Of<IDomainEventDispatcher>());
    }

    private static void SetProperty<T>(T instance, string propertyName, object value)
    {
        var property = typeof(T).GetProperty(propertyName)
            ?? throw new InvalidOperationException($"Property {propertyName} was not found on {typeof(T).Name}.");
        property.SetValue(instance, value);
    }
}

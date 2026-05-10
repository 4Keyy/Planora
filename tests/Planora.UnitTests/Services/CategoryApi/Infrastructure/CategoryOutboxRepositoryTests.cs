using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Planora.Category.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Moq;
using CategoryOutboxRepository = Planora.Category.Infrastructure.Persistence.Repositories.OutboxRepository;

namespace Planora.UnitTests.Services.CategoryApi.Infrastructure;

public sealed class CategoryOutboxRepositoryTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task Repository_ShouldAddSelectRetryableUpdateAndDeleteProcessedMessages()
    {
        using var context = CreateContext();
        var repository = new CategoryOutboxRepository(context);
        var oldestPending = new OutboxMessage("OldestPending", "{}", DateTime.UtcNow.AddMinutes(-30));
        var newestPending = new OutboxMessage("NewestPending", "{}", DateTime.UtcNow.AddMinutes(-5));
        var failedRetryDue = new OutboxMessage("FailedRetryDue", "{}", DateTime.UtcNow.AddMinutes(-20));
        SetProperty(failedRetryDue, nameof(OutboxMessage.Status), OutboxMessageStatus.Failed);
        SetProperty(failedRetryDue, nameof(OutboxMessage.NextRetryUtc), DateTime.UtcNow.AddMinutes(-1));
        var failedRetryFuture = new OutboxMessage("FailedRetryFuture", "{}", DateTime.UtcNow.AddMinutes(-40));
        SetProperty(failedRetryFuture, nameof(OutboxMessage.Status), OutboxMessageStatus.Failed);
        SetProperty(failedRetryFuture, nameof(OutboxMessage.NextRetryUtc), DateTime.UtcNow.AddHours(1));
        var processedOld = new OutboxMessage("ProcessedOld", "{}", DateTime.UtcNow.AddDays(-3));
        processedOld.MarkAsProcessed();
        SetProperty(processedOld, nameof(OutboxMessage.ProcessedOnUtc), DateTime.UtcNow.AddDays(-2));
        var processedRecent = new OutboxMessage("ProcessedRecent", "{}", DateTime.UtcNow);
        processedRecent.MarkAsProcessed();

        await repository.AddAsync(oldestPending);
        context.OutboxMessages.AddRange(newestPending, failedRetryDue, failedRetryFuture, processedOld, processedRecent);
        await context.SaveChangesAsync();

        var pending = await repository.GetPendingMessagesAsync(batchSize: 10);
        Assert.Equal(
            new[] { "OldestPending", "FailedRetryDue", "NewestPending" },
            pending.Select(message => message.Type));

        oldestPending.MarkAsProcessing();
        await repository.UpdateAsync(oldestPending);
        Assert.Equal(OutboxMessageStatus.Processing, (await context.OutboxMessages.FindAsync(oldestPending.Id))!.Status);

        await repository.DeleteProcessedMessagesAsync(DateTime.UtcNow.AddDays(-1));

        Assert.DoesNotContain(context.OutboxMessages, message => message.Type == "ProcessedOld");
        Assert.Contains(context.OutboxMessages, message => message.Type == "ProcessedRecent");
        Assert.Contains(context.OutboxMessages, message => message.Type == "FailedRetryFuture");
    }

    private static CategoryDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<CategoryDbContext>()
            .UseInMemoryDatabase($"category-outbox-{Guid.NewGuid():N}")
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

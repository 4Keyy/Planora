using System.Text.Json;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Category.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;
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

    [Fact]
    [Trait("TestType", "Regression")]
    public async Task CategoryDeletion_ShouldStageOutboxInOwnerSaveAndAllowRetry()
    {
        var interceptor = new RejectCategorySave();
        using var context = CreateContext(interceptor);
        var category = CategoryEntity.Create(Guid.NewGuid(), "Test category", null, "#000000", null, 0);
        context.Categories.Add(category);
        await context.SaveChangesAsync();

        category.Delete(category.UserId);
        interceptor.RejectNextSave = true;
        await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync());

        Assert.Equal(1, interceptor.StagedOutboxRows);
        Assert.False(await context.Categories.IgnoreQueryFilters().AsNoTracking().Select(row => row.IsDeleted).SingleAsync());
        Assert.Empty(await context.OutboxMessages.AsNoTracking().ToListAsync());

        await context.SaveChangesAsync();
        await context.SaveChangesAsync();

        Assert.True(await context.Categories.IgnoreQueryFilters().AsNoTracking().Select(row => row.IsDeleted).SingleAsync());
        var message = await context.OutboxMessages.AsNoTracking().SingleAsync();
        Assert.Equal(typeof(CategoryDeletedIntegrationEvent).AssemblyQualifiedName, message.Type);
        var deletion = JsonSerializer.Deserialize<CategoryDeletedIntegrationEvent>(message.Content);
        Assert.NotNull(deletion);
        Assert.Equal(category.Id, deletion.CategoryId);
        Assert.Equal(category.UserId, deletion.UserId);
    }

    private static CategoryDbContext CreateContext(params IInterceptor[] interceptors)
    {
        var options = new DbContextOptionsBuilder<CategoryDbContext>()
            .UseInMemoryDatabase($"category-outbox-{Guid.NewGuid():N}")
            .AddInterceptors(interceptors)
            .Options;

        return new CategoryDbContext(options, Mock.Of<IDomainEventDispatcher>());
    }

    private sealed class RejectCategorySave : SaveChangesInterceptor
    {
        public bool RejectNextSave { get; set; }
        public int StagedOutboxRows { get; private set; }

        public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (RejectNextSave)
            {
                RejectNextSave = false;
                var context = Assert.IsType<CategoryDbContext>(eventData.Context);
                StagedOutboxRows = context.ChangeTracker.Entries<OutboxMessage>().Count(entry => entry.State == EntityState.Added);
                throw new DbUpdateException("Synthetic failure before the owner save");
            }

            return ValueTask.FromResult(result);
        }
    }

    private static void SetProperty<T>(T instance, string propertyName, object value)
    {
        var property = typeof(T).GetProperty(propertyName)
            ?? throw new InvalidOperationException($"Property {propertyName} was not found on {typeof(T).Name}.");
        property.SetValue(instance, value);
    }
}

using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.BuildingBlocks.Infrastructure;
using Planora.BuildingBlocks.Infrastructure.Messaging.Events;
using Planora.BuildingBlocks.Infrastructure.Outbox;
using Planora.Category.Application.Features.Categories.Events;
using Planora.Category.Domain.Events;
using Planora.Category.Domain.Repositories;
using Planora.Todo.Application.Features.Todos.Events;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;
using Microsoft.Extensions.Logging;
using Moq;
using CategoryEntity = Planora.Category.Domain.Entities.Category;
using CategoryUserDeletedEventConsumer = Planora.Category.Application.Features.IntegrationEvents.UserDeletedEventConsumer;
using TodoUserDeletedEventConsumer = Planora.Todo.Application.Features.IntegrationEvents.UserDeletedEventConsumer;

namespace Planora.UnitTests.Services.IntegrationEvents;

public sealed class IntegrationEventHandlerTests
{
    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CategoryDeletedDomainEventHandler_ShouldWriteOutboxMessage()
    {
        var outbox = new Mock<IOutboxRepository>();
        OutboxMessage? captured = null;
        outbox
            .Setup(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()))
            .Callback<OutboxMessage, CancellationToken>((message, _) => captured = message)
            .Returns(Task.CompletedTask);
        var handler = new CategoryDeletedDomainEventHandler(
            outbox.Object,
            Mock.Of<ILogger<CategoryDeletedDomainEventHandler>>());
        var categoryId = Guid.NewGuid();
        var userId = Guid.NewGuid();

        await handler.Handle(
            new DomainEventNotification<CategoryDeletedDomainEvent>(new CategoryDeletedDomainEvent(categoryId, userId)),
            CancellationToken.None);

        Assert.NotNull(captured);
        Assert.Contains(nameof(CategoryDeletedIntegrationEvent), captured!.Type);
        Assert.Contains(categoryId.ToString(), captured.Content);
        Assert.Contains(userId.ToString(), captured.Content);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task CategoryDeletedDomainEventHandler_ShouldRethrowOutboxFailures()
    {
        var outbox = new Mock<IOutboxRepository>();
        outbox
            .Setup(x => x.AddAsync(It.IsAny<OutboxMessage>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("outbox unavailable"));
        var handler = new CategoryDeletedDomainEventHandler(
            outbox.Object,
            Mock.Of<ILogger<CategoryDeletedDomainEventHandler>>());

        await Assert.ThrowsAsync<InvalidOperationException>(() => handler.Handle(
            new DomainEventNotification<CategoryDeletedDomainEvent>(new CategoryDeletedDomainEvent(Guid.NewGuid(), Guid.NewGuid())),
            CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CategoryUserDeletedConsumer_ShouldSoftDeleteCategoriesAndSkipEmptyUsers()
    {
        var userId = Guid.NewGuid();
        var categories = new List<CategoryEntity>
        {
            CategoryEntity.Create(userId, "Home", null, "#112233", null, 0),
            CategoryEntity.Create(userId, "Work", null, "#445566", null, 1)
        };
        var repository = new Mock<ICategoryRepository>();
        var unitOfWork = new Mock<IUnitOfWork>();
        repository
            .SetupSequence(x => x.GetByUserIdAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<CategoryEntity>())
            .ReturnsAsync(categories);
        unitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(2);
        var consumer = new CategoryUserDeletedEventConsumer(
            repository.Object,
            unitOfWork.Object,
            Mock.Of<ILogger<CategoryUserDeletedEventConsumer>>());

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "user@example.com"), CancellationToken.None);
        repository.Verify(x => x.Update(It.IsAny<CategoryEntity>()), Times.Never);
        unitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "user@example.com"), CancellationToken.None);

        Assert.All(categories, category =>
        {
            Assert.True(category.IsDeleted);
            Assert.Equal(userId, category.DeletedBy);
        });
        repository.Verify(x => x.Update(It.IsAny<CategoryEntity>()), Times.Exactly(2));
        unitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task CategoryUserDeletedConsumer_ShouldRethrowRepositoryFailures()
    {
        var userId = Guid.NewGuid();
        var repository = new Mock<ICategoryRepository>();
        repository
            .Setup(x => x.GetByUserIdAsync(userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("category repository unavailable"));
        var consumer = new CategoryUserDeletedEventConsumer(
            repository.Object,
            Mock.Of<IUnitOfWork>(),
            Mock.Of<ILogger<CategoryUserDeletedEventConsumer>>());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "user@example.com"), CancellationToken.None));
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task TodoUserDeletedConsumer_ShouldSoftDeleteTodosAndRethrowRepositoryFailures()
    {
        var userId = Guid.NewGuid();
        var todos = new List<TodoItem>
        {
            TodoItem.Create(userId, "First"),
            TodoItem.Create(userId, "Second")
        };
        var repository = new Mock<ITodoRepository>();
        var unitOfWork = new Mock<IUnitOfWork>();
        repository
            .SetupSequence(x => x.GetByUserIdAsync(userId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("todo repository unavailable"))
            .ReturnsAsync(todos);
        unitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(2);
        var consumer = new TodoUserDeletedEventConsumer(
            repository.Object,
            unitOfWork.Object,
            Mock.Of<ILogger<TodoUserDeletedEventConsumer>>());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "user@example.com"), CancellationToken.None));

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "user@example.com"), CancellationToken.None);

        Assert.All(todos, todo =>
        {
            Assert.True(todo.IsDeleted);
            Assert.Equal(userId, todo.DeletedBy);
        });
        repository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Exactly(2));
        unitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task TodoUserDeletedConsumer_ShouldSkipWhenUserHasNoTodos()
    {
        var userId = Guid.NewGuid();
        var repository = new Mock<ITodoRepository>();
        var unitOfWork = new Mock<IUnitOfWork>();
        repository
            .Setup(x => x.GetByUserIdAsync(userId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<TodoItem>());
        var consumer = new TodoUserDeletedEventConsumer(
            repository.Object,
            unitOfWork.Object,
            Mock.Of<ILogger<TodoUserDeletedEventConsumer>>());

        await consumer.HandleAsync(new UserDeletedIntegrationEvent(userId, "user@example.com"), CancellationToken.None);

        repository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Never);
        unitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    [Trait("TestType", "Integration")]
    [Trait("TestType", "Regression")]
    public async Task CategoryDeletedEventHandler_ShouldClearCategoryFromTodosAndSkipEmptyCategories()
    {
        var categoryId = Guid.NewGuid();
        var userId = Guid.NewGuid();
        var todos = new List<TodoItem>
        {
            TodoItem.Create(userId, "First", categoryId: categoryId),
            TodoItem.Create(userId, "Second", categoryId: categoryId)
        };
        var repository = new Mock<ITodoRepository>();
        var unitOfWork = new Mock<IUnitOfWork>();
        repository
            .SetupSequence(x => x.GetByCategoryIdAsync(categoryId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Array.Empty<TodoItem>())
            .ReturnsAsync(todos);
        unitOfWork
            .Setup(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()))
            .ReturnsAsync(2);
        var handler = new CategoryDeletedEventHandler(
            repository.Object,
            unitOfWork.Object,
            Mock.Of<ILogger<CategoryDeletedEventHandler>>());

        await handler.HandleAsync(new CategoryDeletedIntegrationEvent(categoryId, userId), CancellationToken.None);
        repository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Never);
        unitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Never);

        await handler.HandleAsync(new CategoryDeletedIntegrationEvent(categoryId, userId), CancellationToken.None);

        Assert.All(todos, todo => Assert.Null(todo.CategoryId));
        repository.Verify(x => x.Update(It.IsAny<TodoItem>()), Times.Exactly(2));
        unitOfWork.Verify(x => x.SaveChangesAsync(It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    [Trait("TestType", "Resilience")]
    [Trait("TestType", "Regression")]
    public async Task CategoryDeletedEventHandler_ShouldRethrowRepositoryFailures()
    {
        var categoryId = Guid.NewGuid();
        var repository = new Mock<ITodoRepository>();
        repository
            .Setup(x => x.GetByCategoryIdAsync(categoryId, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("todo category lookup failed"));
        var handler = new CategoryDeletedEventHandler(
            repository.Object,
            Mock.Of<IUnitOfWork>(),
            Mock.Of<ILogger<CategoryDeletedEventHandler>>());

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            handler.HandleAsync(new CategoryDeletedIntegrationEvent(categoryId, Guid.NewGuid()), CancellationToken.None));
    }
}

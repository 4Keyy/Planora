using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Todo.Application;
using Planora.Todo.Application.Features.IntegrationEvents;
using Planora.Todo.Application.Services;
using Planora.Todo.Domain.Entities;
using Planora.Todo.Domain.Repositories;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class FriendshipRemovedRegistrationTests
{
    [Fact]
    public async Task ActualApplicationRegistration_ResolvesTheSubscribedConsumerAndStagesAccessRevocation()
    {
        var owner = Guid.NewGuid(); var friend = Guid.NewGuid();
        using var cancellation = new CancellationTokenSource();
        var repository = new Mock<ITodoRepository>();
        repository.Setup(r => r.StageRevokeFriendshipAccessAsync(owner, friend, cancellation.Token))
            .ReturnsAsync(Array.Empty<TodoItem>());
        var services = new ServiceCollection();
        services.AddSingleton(repository.Object);
        services.AddSingleton(Mock.Of<IUnitOfWork>());
        services.AddSingleton(Mock.Of<IOutboxRepository>());
        services.AddSingleton(Mock.Of<IFriendshipService>());
        services.AddSingleton<ILogger<FriendshipRemovedEventConsumer>>(NullLogger<FriendshipRemovedEventConsumer>.Instance);
        services.AddTodoApplication();
        await using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        await using var scope = provider.CreateAsyncScope();
        var consumer = scope.ServiceProvider.GetRequiredService<FriendshipRemovedEventConsumer>();
        await consumer.HandleAsync(new FriendshipRemovedIntegrationEvent(owner, friend), cancellation.Token);
        repository.Verify(r => r.StageRevokeFriendshipAccessAsync(owner, friend, cancellation.Token), Times.Once);
        repository.Verify(r => r.RemoveSharesBetweenUsersAsync(It.IsAny<Guid>(), It.IsAny<Guid>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}

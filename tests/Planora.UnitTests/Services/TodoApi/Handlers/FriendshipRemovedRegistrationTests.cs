using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.Todo.Application;
using Planora.Todo.Application.Features.IntegrationEvents;
using Planora.Todo.Domain.Repositories;

namespace Planora.UnitTests.Services.TodoApi.Handlers;

public sealed class FriendshipRemovedRegistrationTests
{
    [Fact]
    public async Task ActualApplicationRegistration_ResolvesTheSubscribedConsumerAndRevokesShares()
    {
        var owner = Guid.NewGuid(); var friend = Guid.NewGuid();
        using var cancellation = new CancellationTokenSource();
        var repository = new Mock<ITodoRepository>();
        var services = new ServiceCollection();
        services.AddSingleton(repository.Object);
        services.AddSingleton<ILogger<FriendshipRemovedEventConsumer>>(NullLogger<FriendshipRemovedEventConsumer>.Instance);
        services.AddTodoApplication();
        await using var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true });
        await using var scope = provider.CreateAsyncScope();
        var consumer = scope.ServiceProvider.GetRequiredService<FriendshipRemovedEventConsumer>();
        await consumer.HandleAsync(new FriendshipRemovedIntegrationEvent(owner, friend), cancellation.Token);
        repository.Verify(r => r.RemoveSharesBetweenUsersAsync(owner, friend, cancellation.Token), Times.Once);
    }
}

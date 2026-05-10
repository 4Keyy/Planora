using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Domain;
using Planora.Category.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using System.Reflection;

namespace Planora.UnitTests.Services.Infrastructure;

public sealed class DesignTimeDbContextFactoryTests
{
    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void DesignTimeFactories_ShouldCreateNpgsqlDbContextsFromEnvironmentConnectionStrings()
    {
        using var auth = CreateDbContext<AuthDbContext>(
            typeof(AuthDbContext).Assembly,
            "Planora.Auth.Infrastructure.DesignTime.AuthDbContextFactory",
            "ConnectionStrings__AuthDatabase");
        using var category = CreateDbContext<CategoryDbContext>(
            typeof(CategoryDbContext).Assembly,
            "Planora.Category.Infrastructure.DesignTime.CategoryDbContextFactory",
            "ConnectionStrings__CategoryDatabase");
        using var todo = CreateDbContext<TodoDbContext>(
            typeof(TodoDbContext).Assembly,
            "Planora.Todo.Infrastructure.DesignTime.TodoDbContextFactory",
            "ConnectionStrings__TodoDatabase");

        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", auth.Database.ProviderName);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", category.Database.ProviderName);
        Assert.Equal("Npgsql.EntityFrameworkCore.PostgreSQL", todo.Database.ProviderName);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public async Task AuthDesignTimeStubs_ShouldReturnNoCurrentUserAndCompleteDomainDispatch()
    {
        var assembly = typeof(AuthDbContext).Assembly;
        var currentUserType = assembly.GetType(
            "Planora.Auth.Infrastructure.DesignTime.DesignTimeCurrentUserService",
            throwOnError: true)!;
        var dispatcherType = assembly.GetType(
            "Planora.Auth.Infrastructure.DesignTime.DesignTimeDomainEventDispatcher",
            throwOnError: true)!;
        var currentUser = Activator.CreateInstance(currentUserType, nonPublic: true)!;
        var dispatcher = Activator.CreateInstance(dispatcherType, nonPublic: true)!;

        Assert.Null(currentUserType.GetProperty("UserId")!.GetValue(currentUser));
        Assert.Null(currentUserType.GetProperty("Email")!.GetValue(currentUser));
        Assert.Null(currentUserType.GetProperty("IpAddress")!.GetValue(currentUser));
        Assert.Null(currentUserType.GetProperty("UserAgent")!.GetValue(currentUser));
        Assert.False((bool)currentUserType.GetProperty("IsAuthenticated")!.GetValue(currentUser)!);
        Assert.Empty((IEnumerable<string>)currentUserType.GetProperty("Roles")!.GetValue(currentUser)!);
        Assert.Empty((IDictionary<string, string>)currentUserType.GetProperty("Claims")!.GetValue(currentUser)!);

        var singleDispatch = (Task)dispatcherType.GetMethod("DispatchAsync", new[]
        {
            typeof(Planora.BuildingBlocks.Domain.Interfaces.IDomainEvent),
            typeof(CancellationToken)
        })!.Invoke(dispatcher, new object[] { new SampleDomainEvent(Guid.NewGuid()), CancellationToken.None })!;
        await singleDispatch;

        var manyDispatch = (Task)dispatcherType.GetMethods()
            .Single(method =>
                method.Name == "DispatchAsync" &&
                method.GetParameters()[0].ParameterType != typeof(Planora.BuildingBlocks.Domain.Interfaces.IDomainEvent))
            .Invoke(dispatcher, new object[]
            {
                new[] { new SampleDomainEvent(Guid.NewGuid()) },
                CancellationToken.None
            })!;
        await manyDispatch;

        var categoryDispatcherType = typeof(CategoryDbContext).Assembly.GetType(
            "Planora.Category.Infrastructure.DesignTime.DesignTimeDomainEventDispatcher",
            throwOnError: true)!;
        var categoryDispatcher = Activator.CreateInstance(categoryDispatcherType, nonPublic: true)!;
        var categoryDispatch = (Task)categoryDispatcherType.GetMethod("DispatchAsync")!
            .Invoke(categoryDispatcher, new object[] { new SampleDomainEvent(Guid.NewGuid()), CancellationToken.None })!;
        await categoryDispatch;
    }

    private static TContext CreateDbContext<TContext>(Assembly assembly, string factoryTypeName, string environmentVariable)
        where TContext : DbContext
    {
        var previous = Environment.GetEnvironmentVariable(environmentVariable);
        Environment.SetEnvironmentVariable(
            environmentVariable,
            "Host=localhost;Port=5432;Database=planora_design_time_tests;Username=postgres;Password=postgres");
        try
        {
            var factoryType = assembly.GetType(factoryTypeName, throwOnError: true)!;
            var factory = Activator.CreateInstance(factoryType, nonPublic: true)!;
            return Assert.IsType<TContext>(factoryType.GetMethod("CreateDbContext")!
                .Invoke(factory, new object[] { Array.Empty<string>() }));
        }
        finally
        {
            Environment.SetEnvironmentVariable(environmentVariable, previous);
        }
    }

    private sealed record SampleDomainEvent(Guid EntityId) : DomainEvent;
}

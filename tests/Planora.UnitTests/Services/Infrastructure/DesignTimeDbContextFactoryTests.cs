using Planora.Auth.Infrastructure.Persistence;
using Planora.BuildingBlocks.Domain;
using Planora.Category.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence;
using Planora.Messaging.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using System.Reflection;
using System.Text.Json;

namespace Planora.UnitTests.Services.Infrastructure;

[CollectionDefinition("DesignTimeConfiguration", DisableParallelization = true)]
public sealed class DesignTimeConfigurationCollection;

[Collection("DesignTimeConfiguration")]
public sealed class DesignTimeDbContextFactoryTests
{
    [Fact]
    public void MessagingFactory_UsesNamedEnvironmentBeforeJsonAndLegacy()
    {
        using var scope = new MessagingFactoryScope(
            new() { ["MessagingDatabase"] = Connection("named_json"), ["DefaultConnection"] = Connection("legacy_json") },
            namedEnvironment: Connection("named_environment"), legacyEnvironment: Connection("legacy_environment"));
        using var context = CreateMessagingContext();

        Assert.Equal("named_environment", ConfiguredDatabase(context));
    }

    [Fact]
    public void MessagingFactory_UsesNamedJsonBeforeLegacyEnvironment()
    {
        using var scope = new MessagingFactoryScope(
            new() { ["MessagingDatabase"] = Connection("named_json"), ["DefaultConnection"] = Connection("legacy_json") },
            legacyEnvironment: Connection("legacy_environment"));
        using var context = CreateMessagingContext();

        Assert.Equal("named_json", ConfiguredDatabase(context));
    }

    [Fact]
    public void MessagingFactory_PreservesLegacyEnvironmentWhenNamedMissing()
    {
        using var scope = new MessagingFactoryScope(legacyEnvironment: Connection("legacy_environment"));
        using var context = CreateMessagingContext();

        Assert.Equal("legacy_environment", ConfiguredDatabase(context));
    }

    [Fact]
    public void MessagingFactory_RejectsMissingConnectionInsteadOfUsingDevelopmentDefault()
    {
        using var scope = new MessagingFactoryScope();

        var exception = Record.Exception(() => { using var context = CreateMessagingContext(); });

        var wrapper = Assert.IsType<TargetInvocationException>(exception);
        Assert.IsType<InvalidOperationException>(wrapper.InnerException);
    }

    [Fact]
    public void MessagingFactory_RejectsBlankNamedConnectionInsteadOfFallingBackToLegacy()
    {
        using var scope = new MessagingFactoryScope(
            new() { ["MessagingDatabase"] = " ", ["DefaultConnection"] = Connection("legacy_json") });

        var exception = Record.Exception(() => { using var context = CreateMessagingContext(); });

        var wrapper = Assert.IsType<TargetInvocationException>(exception);
        Assert.IsType<InvalidOperationException>(wrapper.InnerException);
    }

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
        var categoryDispatch = (Task)categoryDispatcherType.GetMethod("DispatchAsync", new[]
        {
            typeof(Planora.BuildingBlocks.Domain.Interfaces.IDomainEvent),
            typeof(CancellationToken)
        })!.Invoke(categoryDispatcher, new object[] { new SampleDomainEvent(Guid.NewGuid()), CancellationToken.None })!;
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

    private static string Connection(string database)
        => new NpgsqlConnectionStringBuilder { Host = "127.0.0.1", Database = database, Username = "synthetic" }.ConnectionString;

    private static string ConfiguredDatabase(MessagingDbContext context)
        => new NpgsqlConnectionStringBuilder(context.Database.GetConnectionString()).Database!;

    private static MessagingDbContext CreateMessagingContext()
    {
        var factoryType = typeof(MessagingDbContext).Assembly.GetType(
            "Planora.Messaging.Infrastructure.DesignTime.MessagingDbContextFactory", throwOnError: true)!;
        var factory = Activator.CreateInstance(factoryType, nonPublic: true)!;
        return Assert.IsType<MessagingDbContext>(factoryType.GetMethod("CreateDbContext")!
            .Invoke(factory, new object[] { Array.Empty<string>() }));
    }

    private sealed class MessagingFactoryScope : IDisposable
    {
        private static readonly string[] Keys =
        [
            "ConnectionStrings__MessagingDatabase", "ConnectionStrings:MessagingDatabase",
            "ConnectionStrings__DefaultConnection", "ConnectionStrings:DefaultConnection"
        ];
        private readonly string _previousDirectory = Directory.GetCurrentDirectory();
        private readonly Dictionary<string, string?> _previousEnvironment = Keys.ToDictionary(
            key => key, Environment.GetEnvironmentVariable);
        private readonly string _directory = Path.Combine(Path.GetTempPath(), "planora-messaging-factory-" + Guid.NewGuid().ToString("N"));

        public MessagingFactoryScope(Dictionary<string, string>? jsonConnections = null,
            string? namedEnvironment = null, string? legacyEnvironment = null)
        {
            try
            {
                Directory.CreateDirectory(_directory);
                if (jsonConnections is not null)
                    File.WriteAllText(Path.Combine(_directory, "appsettings.json"),
                        JsonSerializer.Serialize(new { ConnectionStrings = jsonConnections }));
                Directory.SetCurrentDirectory(_directory);
                foreach (var key in Keys)
                    Environment.SetEnvironmentVariable(key, null);
                Environment.SetEnvironmentVariable(Keys[0], namedEnvironment);
                Environment.SetEnvironmentVariable(Keys[2], legacyEnvironment);
            }
            catch
            {
                Dispose();
                throw;
            }
        }

        public void Dispose()
        {
            Directory.SetCurrentDirectory(_previousDirectory);
            foreach (var (key, value) in _previousEnvironment)
                Environment.SetEnvironmentVariable(key, value);
            File.Delete(Path.Combine(_directory, "appsettings.json"));
            if (Directory.Exists(_directory))
                Directory.Delete(_directory);
        }
    }
}

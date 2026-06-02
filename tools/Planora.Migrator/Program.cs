using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Auth.Infrastructure.Persistence;
using Planora.Category.Infrastructure.Persistence;
using Planora.Collaboration.Infrastructure.Persistence;
using Planora.Messaging.Infrastructure.Persistence;
using Planora.Realtime.Infrastructure.Persistence;
using Planora.Todo.Infrastructure.Persistence;

namespace Planora.Migrator;

/// <summary>
/// One-shot migration runner. Applies pending EF Core migrations for one or
/// all Planora services, then exits with a non-zero status if anything failed.
///
/// Usage:
///   Planora.Migrator --all
///   Planora.Migrator --service auth
///   Planora.Migrator --service todo --connection-string "Host=..."
///   Planora.Migrator --list-pending
///
/// Connection strings are read in this priority order:
///   1. --connection-string CLI flag (overrides everything)
///   2. ConnectionStrings:&lt;Name&gt; from appsettings.json or env (ASP.NET convention)
///   3. The service-specific env var (e.g. AUTH_DATABASE) when neither is set
/// </summary>
internal static class Program
{
    private const int ExitSuccess = 0;
    private const int ExitBadArgs = 64;
    private const int ExitMigrationFailed = 70;

    private static readonly IReadOnlyList<ServiceMigration> Services =
    [
        new("auth",      "AuthDatabase",      typeof(AuthDbContext),      RequiresDispatcher: true),
        new("category",  "CategoryDatabase",  typeof(CategoryDbContext),  RequiresDispatcher: true),
        new("todo",      "TodoDatabase",      typeof(TodoDbContext),      RequiresDispatcher: false),
        new("messaging", "MessagingDatabase", typeof(MessagingDbContext), RequiresDispatcher: false),
        // T2.5 — Realtime persisted Notification + NotificationDelivery + Outbox schema.
        new("realtime",  "RealtimeDatabase",  typeof(RealtimeDbContext),  RequiresDispatcher: true),
        new("collaboration", "CollaborationDatabase", typeof(CollaborationDbContext), RequiresDispatcher: false),
    ];

    public static async Task<int> Main(string[] args)
    {
        var parsed = ParseArgs(args);
        if (parsed is null)
        {
            PrintUsage();
            return ExitBadArgs;
        }

        var configuration = new ConfigurationBuilder()
            .AddJsonFile("appsettings.json", optional: true)
            .AddJsonFile($"appsettings.{Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ?? "Production"}.json", optional: true)
            .AddEnvironmentVariables()
            .Build();

        using var loggerFactory = LoggerFactory.Create(builder => builder
            .AddSimpleConsole(o =>
            {
                o.SingleLine = true;
                o.TimestampFormat = "HH:mm:ss ";
            })
            .SetMinimumLevel(LogLevel.Information));
        var logger = loggerFactory.CreateLogger("Planora.Migrator");

        var selected = parsed.AllServices
            ? Services
            : Services.Where(s => parsed.Services.Contains(s.Name, StringComparer.OrdinalIgnoreCase)).ToList();

        if (selected.Count == 0 && !parsed.BackfillCollaboration)
        {
            logger.LogError("No matching services. Valid names: {Names}", string.Join(", ", Services.Select(s => s.Name)));
            return ExitBadArgs;
        }

        var overallStopwatch = Stopwatch.StartNew();
        var anyFailure = false;

        foreach (var service in selected)
        {
            var connectionString = parsed.OverrideConnectionString
                ?? configuration.GetConnectionString(service.ConnectionStringName);

            if (string.IsNullOrWhiteSpace(connectionString))
            {
                logger.LogError(
                    "{Service}: connection string is empty. Set ConnectionStrings__{Key} (env) or pass --connection-string.",
                    service.Name, service.ConnectionStringName);
                anyFailure = true;
                continue;
            }

            var ok = await RunForServiceAsync(service, connectionString, parsed.ListPendingOnly, loggerFactory);
            anyFailure |= !ok;
        }

        if (parsed.BackfillCollaboration && !parsed.ListPendingOnly)
        {
            var todoConn = configuration.GetConnectionString("TodoDatabase");
            var collabConn = configuration.GetConnectionString("CollaborationDatabase");
            if (string.IsNullOrWhiteSpace(todoConn) || string.IsNullOrWhiteSpace(collabConn))
            {
                logger.LogError(
                    "Backfill requires ConnectionStrings__TodoDatabase and ConnectionStrings__CollaborationDatabase.");
                anyFailure = true;
            }
            else
            {
                try
                {
                    await CollaborationBackfill.RunAsync(todoConn, collabConn, logger);
                }
                catch (Exception ex)
                {
                    logger.LogError(ex, "Collaboration backfill failed.");
                    anyFailure = true;
                }
            }
        }

        overallStopwatch.Stop();
        logger.LogInformation("Migrator finished in {Elapsed}. Outcome: {Outcome}",
            overallStopwatch.Elapsed, anyFailure ? "FAILED" : "OK");

        return anyFailure ? ExitMigrationFailed : ExitSuccess;
    }

    private static async Task<bool> RunForServiceAsync(
        ServiceMigration service,
        string connectionString,
        bool listPendingOnly,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger(service.Name);
        var sw = Stopwatch.StartNew();

        var services = new ServiceCollection();
        services.AddSingleton(loggerFactory);
        services.AddLogging();
        if (service.RequiresDispatcher)
        {
            services.AddSingleton<IDomainEventDispatcher>(_ => new NoOpDomainEventDispatcher());
        }

        AddDbContext(service.DbContextType, services, connectionString);

        await using var provider = services.BuildServiceProvider();
        using var scope = provider.CreateScope();

        try
        {
            var context = (DbContext)scope.ServiceProvider.GetRequiredService(service.DbContextType);

            // SCHEMA DRIFT GUARD — applied set must be a subset of code set.
            // Any "ghost" migration recorded in __EFMigrationsHistory but absent from the
            // compiled assembly indicates a developer deleted a migration file locally,
            // or a deploy ran against a database that was on a more advanced schema than
            // the one shipping now. Either case is a hard stop: silently running a partial
            // migration would corrupt the history. Operators must reconcile manually.
            var codeSet = context.Database.GetMigrations().ToHashSet(StringComparer.Ordinal);
            var applied = (await context.Database.GetAppliedMigrationsAsync()).ToList();
            var drifted = applied.Where(m => !codeSet.Contains(m)).ToList();
            if (drifted.Count > 0)
            {
                logger.LogError(
                    "Schema drift detected: {Count} migration(s) applied to the database are not in the current code base: {Migrations}. " +
                    "Either restore the migration files in code, or reset the target environment, before re-running. " +
                    "Migrator will not partially apply against an unknown schema.",
                    drifted.Count, string.Join(", ", drifted));
                sw.Stop();
                return false;
            }

            var pending = (await context.Database.GetPendingMigrationsAsync()).ToList();
            if (pending.Count == 0)
            {
                logger.LogInformation("No pending migrations. Applied so far: {AppliedCount}.", applied.Count);
                sw.Stop();
                return true;
            }

            logger.LogInformation("Pending migrations ({Count}): {Names}",
                pending.Count, string.Join(", ", pending));

            if (listPendingOnly)
            {
                sw.Stop();
                return true;
            }

            await context.Database.MigrateAsync();
            sw.Stop();
            logger.LogInformation("Migrations applied successfully in {Elapsed}.", sw.Elapsed);
            return true;
        }
        catch (Exception ex)
        {
            sw.Stop();
            logger.LogError(ex, "Migration failed after {Elapsed}.", sw.Elapsed);
            return false;
        }
    }

    private static void AddDbContext(Type contextType, IServiceCollection services, string connectionString)
    {
        // Equivalent to services.AddDbContext<TContext>(opts => opts.UseNpgsql(connectionString))
        // but resolved generically from a Type at runtime.
        var addDbContext = typeof(EntityFrameworkServiceCollectionExtensions)
            .GetMethods()
            .Single(m => m.Name == nameof(EntityFrameworkServiceCollectionExtensions.AddDbContext)
                         && m.IsGenericMethod
                         && m.GetGenericArguments().Length == 1
                         && m.GetParameters().Length == 4)
            .MakeGenericMethod(contextType);

        Action<DbContextOptionsBuilder> configureOptions = opts => opts.UseNpgsql(connectionString);

        addDbContext.Invoke(null, new object?[]
        {
            services,
            configureOptions,
            ServiceLifetime.Scoped,
            ServiceLifetime.Scoped,
        });
    }

    private static ParsedArgs? ParseArgs(string[] args)
    {
        var allServices = false;
        var listPending = false;
        var backfillCollaboration = false;
        string? overrideConnStr = null;
        var services = new List<string>();

        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--all":
                    allServices = true;
                    break;
                case "--list-pending":
                    listPending = true;
                    break;
                case "--backfill-collaboration":
                    backfillCollaboration = true;
                    break;
                case "--service" when i + 1 < args.Length:
                    services.Add(args[++i]);
                    break;
                case "--connection-string" when i + 1 < args.Length:
                    overrideConnStr = args[++i];
                    break;
                case "-h" or "--help":
                    return null;
                default:
                    Console.Error.WriteLine($"Unknown argument: {args[i]}");
                    return null;
            }
        }

        if (!allServices && services.Count == 0 && !backfillCollaboration)
        {
            return null;
        }

        return new ParsedArgs(allServices, services, listPending, backfillCollaboration, overrideConnStr);
    }

    private static void PrintUsage()
    {
        Console.WriteLine("""
            Planora.Migrator — applies pending EF Core migrations.

            USAGE
              Planora.Migrator --all
              Planora.Migrator --service <name> [--service <name> ...]
              Planora.Migrator --all --list-pending
              Planora.Migrator --service <name> --connection-string "Host=..."
              Planora.Migrator --backfill-collaboration

            SERVICES
              auth, category, todo, messaging, realtime, collaboration

            CONFIG
              Connection strings: ConnectionStrings__AuthDatabase, ConnectionStrings__CategoryDatabase,
              ConnectionStrings__TodoDatabase, ConnectionStrings__MessagingDatabase,
              ConnectionStrings__RealtimeDatabase, ConnectionStrings__CollaborationDatabase
              (envvar or appsettings.json). Override per-run with --connection-string.

            BACKFILL
              --backfill-collaboration copies todo.todo_item_comments ->
              collaboration.comments (idempotent). Needs ConnectionStrings__TodoDatabase
              and ConnectionStrings__CollaborationDatabase.

            EXIT CODES
              0   success
              64  bad arguments
              70  one or more migrations failed
            """);
    }

    private sealed record ServiceMigration(
        string Name,
        string ConnectionStringName,
        Type DbContextType,
        bool RequiresDispatcher);

    private sealed record ParsedArgs(
        bool AllServices,
        List<string> Services,
        bool ListPendingOnly,
        bool BackfillCollaboration,
        string? OverrideConnectionString);

    /// <summary>
    /// IDomainEventDispatcher implementation that drops every event on the floor.
    /// Migrations never touch domain events (no SaveChanges with mutations) — they only
    /// shape the schema — so a real dispatcher with RabbitMQ/MediatR wiring would be
    /// dead weight here and would pull half the application graph into a CLI tool.
    /// </summary>
    private sealed class NoOpDomainEventDispatcher : IDomainEventDispatcher
    {
        public Task DispatchAsync(IDomainEvent domainEvent, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task DispatchAsync(IEnumerable<IDomainEvent> domainEvents, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}

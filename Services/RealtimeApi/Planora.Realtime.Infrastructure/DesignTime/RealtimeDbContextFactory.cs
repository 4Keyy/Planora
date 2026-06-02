using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Planora.BuildingBlocks.Application.Messaging;
using Planora.BuildingBlocks.Domain.Interfaces;
using Planora.Realtime.Infrastructure.Persistence;

namespace Planora.Realtime.Infrastructure.DesignTime;

/// <summary>
/// Design-time factory for <c>dotnet ef</c> commands. Mirrors the Category/Auth
/// services' factory so EF tooling can construct the context without booting
/// the full ASP.NET pipeline.
/// </summary>
internal sealed class RealtimeDbContextFactory : IDesignTimeDbContextFactory<RealtimeDbContext>
{
    public RealtimeDbContext CreateDbContext(string[] args)
    {
        var basePath = Directory.GetCurrentDirectory();
        var builder = new ConfigurationBuilder()
            .SetBasePath(basePath)
            .AddJsonFile("appsettings.json", optional: true)
            .AddEnvironmentVariables();

        var configuration = builder.Build();
        var conn = configuration.GetConnectionString("RealtimeDatabase")
                   ?? Environment.GetEnvironmentVariable("ConnectionStrings__RealtimeDatabase");
        if (string.IsNullOrWhiteSpace(conn))
        {
            // T2.5 — design-time factory deliberately refuses to ship with a
            // hard-coded password literal. Sister DbContextFactories carry a
            // grandfathered `Password=postgres` fallback that predates the
            // `planora-postgres-connection-string-literal` gitleaks rule; new
            // factories must read the connection string from configuration or
            // fail loudly so `dotnet ef` operators see the missing piece.
            throw new InvalidOperationException(
                "Set ConnectionStrings__RealtimeDatabase (env or appsettings.json) before running `dotnet ef` against RealtimeDbContext.");
        }

        var optionsBuilder = new DbContextOptionsBuilder<RealtimeDbContext>();
        optionsBuilder.UseNpgsql(conn);

        return new RealtimeDbContext(optionsBuilder.Options, new DesignTimeDomainEventDispatcher());
    }

    private sealed class DesignTimeDomainEventDispatcher : IDomainEventDispatcher
    {
        public Task DispatchAsync(IDomainEvent domainEvent, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task DispatchAsync(IEnumerable<IDomainEvent> domainEvents, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}

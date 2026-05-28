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
                   ?? Environment.GetEnvironmentVariable("ConnectionStrings__RealtimeDatabase")
                   ?? "Host=localhost;Port=5432;Database=planora_realtime;Username=postgres;Password=postgres";

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

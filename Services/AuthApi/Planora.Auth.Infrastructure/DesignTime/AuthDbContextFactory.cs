using Planora.BuildingBlocks.Infrastructure;

namespace Planora.Auth.Infrastructure.DesignTime
{
    internal sealed class AuthDbContextFactory : IDesignTimeDbContextFactory<AuthDbContext>
    {
        public AuthDbContext CreateDbContext(string[] args)
        {
            var basePath = Directory.GetCurrentDirectory();
            var builder = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables();

            var configuration = builder.Build();
            var conn = configuration.GetConnectionString("AuthDatabase")
                       ?? Environment.GetEnvironmentVariable("ConnectionStrings__AuthDatabase")
                       ?? "Host=localhost;Port=5432;Database=planora_auth;Username=postgres;Password=postgres";

            var optionsBuilder = new DbContextOptionsBuilder<AuthDbContext>();
            optionsBuilder.UseNpgsql(conn);

            // Provide lightweight stubs for design-time DbContext construction
            var domainDispatcher = new DesignTimeDomainEventDispatcher();

            return new AuthDbContext(optionsBuilder.Options, domainDispatcher);
        }
    }

    internal sealed class DesignTimeDomainEventDispatcher : Planora.BuildingBlocks.Infrastructure.Messaging.IDomainEventDispatcher
    {
        public Task DispatchAsync(Planora.BuildingBlocks.Domain.Interfaces.IDomainEvent domainEvent, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task DispatchAsync(IEnumerable<Planora.BuildingBlocks.Domain.Interfaces.IDomainEvent> domainEvents, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }

    internal sealed class DesignTimeCurrentUserService : ICurrentUserService
    {
        public Guid? UserId => null;
        public string? Email => null;
        public string? IpAddress => null;
        public string? UserAgent => null;
        public bool IsAuthenticated => false;
        public IEnumerable<string> Roles => Array.Empty<string>();
        public IDictionary<string, string> Claims => new Dictionary<string, string>();
    }
}

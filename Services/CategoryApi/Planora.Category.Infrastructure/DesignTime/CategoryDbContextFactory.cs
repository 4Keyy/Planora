using Planora.BuildingBlocks.Infrastructure;

namespace Planora.Category.Infrastructure.DesignTime
{
    internal sealed class CategoryDbContextFactory : IDesignTimeDbContextFactory<CategoryDbContext>
    {
        public CategoryDbContext CreateDbContext(string[] args)
        {
            var basePath = Directory.GetCurrentDirectory();
            var builder = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables();

            var configuration = builder.Build();
            var conn = configuration.GetConnectionString("CategoryDatabase")
                       ?? Environment.GetEnvironmentVariable("ConnectionStrings__CategoryDatabase")
                       ?? "Host=localhost;Port=5432;Database=planora_category;Username=postgres;Password=postgres";

            var optionsBuilder = new DbContextOptionsBuilder<CategoryDbContext>();
            optionsBuilder.UseNpgsql(conn);

            // Provide lightweight stub for design-time DbContext construction
            var domainDispatcher = new DesignTimeDomainEventDispatcher();

            return new CategoryDbContext(optionsBuilder.Options, domainDispatcher);
        }
    }

    internal sealed class DesignTimeDomainEventDispatcher : IDomainEventDispatcher
    {
        public Task DispatchAsync(Planora.BuildingBlocks.Domain.Interfaces.IDomainEvent domainEvent, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}

using Microsoft.EntityFrameworkCore.Design;

namespace Planora.Collaboration.Infrastructure.DesignTime
{
    internal sealed class CollaborationDbContextFactory : IDesignTimeDbContextFactory<CollaborationDbContext>
    {
        public CollaborationDbContext CreateDbContext(string[] args)
        {
            var basePath = Directory.GetCurrentDirectory();
            var builder = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables();

            var configuration = builder.Build();
            var conn = configuration.GetConnectionString("CollaborationDatabase")
                       ?? Environment.GetEnvironmentVariable("ConnectionStrings__CollaborationDatabase")
                       ?? "Host=localhost;Port=5433;Database=planora_collaboration;Username=postgres;Password=postgres";

            var optionsBuilder = new DbContextOptionsBuilder<CollaborationDbContext>();
            optionsBuilder.UseNpgsql(conn);

            return new CollaborationDbContext(optionsBuilder.Options);
        }
    }
}

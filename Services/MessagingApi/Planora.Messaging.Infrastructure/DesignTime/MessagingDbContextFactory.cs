namespace Planora.Messaging.Infrastructure.DesignTime
{
    internal sealed class MessagingDbContextFactory : IDesignTimeDbContextFactory<MessagingDbContext>
    {
        public MessagingDbContext CreateDbContext(string[] args)
        {
            var basePath = Directory.GetCurrentDirectory();
            var builder = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: true);

            var configuration = builder.Build();
            var conn = configuration.GetConnectionString("DefaultConnection")
                       ?? Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection")
                       ?? "Host=localhost;Port=5432;Database=planora_messaging;Username=postgres;Password=postgres";

            var optionsBuilder = new DbContextOptionsBuilder<MessagingDbContext>();
            optionsBuilder.UseNpgsql(conn);

            return new MessagingDbContext(optionsBuilder.Options);
        }
    }
}

namespace Planora.Messaging.Infrastructure.DesignTime
{
    internal sealed class MessagingDbContextFactory : IDesignTimeDbContextFactory<MessagingDbContext>
    {
        public MessagingDbContext CreateDbContext(string[] args)
        {
            var basePath = Directory.GetCurrentDirectory();
            var builder = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables();

            var configuration = builder.Build();
            var conn = configuration.GetConnectionString("MessagingDatabase")
                       ?? configuration.GetConnectionString("DefaultConnection");
            if (string.IsNullOrWhiteSpace(conn))
                throw new InvalidOperationException("Design-time MessagingDatabase connection string is required.");

            var optionsBuilder = new DbContextOptionsBuilder<MessagingDbContext>();
            optionsBuilder.UseNpgsql(conn);

            return new MessagingDbContext(optionsBuilder.Options);
        }
    }
}

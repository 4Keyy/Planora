namespace Planora.Todo.Infrastructure.DesignTime
{
    internal sealed class TodoDbContextFactory : IDesignTimeDbContextFactory<TodoDbContext>
    {
        public TodoDbContext CreateDbContext(string[] args)
        {
            var basePath = Directory.GetCurrentDirectory();
            var builder = new ConfigurationBuilder()
                .SetBasePath(basePath)
                .AddJsonFile("appsettings.json", optional: true)
                .AddEnvironmentVariables();

            var configuration = builder.Build();
            var conn = configuration.GetConnectionString("TodoDatabase")
                       ?? Environment.GetEnvironmentVariable("ConnectionStrings__TodoDatabase")
                       ?? "Host=localhost;Port=5432;Database=planora_todo;Username=postgres;Password=postgres";

            var optionsBuilder = new DbContextOptionsBuilder<TodoDbContext>();
            optionsBuilder.UseNpgsql(conn);

            return new TodoDbContext(optionsBuilder.Options);
        }
    }
}

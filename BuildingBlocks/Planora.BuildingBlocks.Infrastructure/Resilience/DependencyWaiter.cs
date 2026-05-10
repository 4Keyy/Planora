using System.Diagnostics;
using Npgsql;

namespace Planora.BuildingBlocks.Infrastructure.Resilience
{
    public static class DependencyWaiter
    {
        private const int MaxRetries = 30;
        private const int DelayMs = 1000;

        public static async Task WaitForPostgresAsync(
            Func<Task> testConnection,
            ILogger logger,
            CancellationToken cancellationToken)
        {
            await WaitForDependencyAsync(
                testConnection,
                "PostgreSQL",
                logger,
                cancellationToken);
        }

        public static async Task WaitForPostgresWithDatabaseCreationAsync(
            string connectionString,
            string databaseName,
            ILogger logger,
            CancellationToken cancellationToken)
        {
            // First, wait for postgres server
            var serverConnectionString = GetServerConnectionString(connectionString);
            await WaitForDependencyAsync(
                async () =>
                {
                    await using var connection = new NpgsqlConnection(serverConnectionString);
                    await connection.OpenAsync(cancellationToken);
                },
                "PostgreSQL Server",
                logger,
                cancellationToken);

            // Then, create database if not exists
            await CreateDatabaseIfNotExistsAsync(serverConnectionString, databaseName, logger, cancellationToken);

            // Finally, wait for the specific database
            await WaitForDependencyAsync(
                async () =>
                {
                    await using var connection = new NpgsqlConnection(connectionString);
                    await connection.OpenAsync(cancellationToken);
                },
                $"PostgreSQL Database '{databaseName}'",
                logger,
                cancellationToken);
        }

        private static string GetServerConnectionString(string connectionString)
        {
            var builder = new NpgsqlConnectionStringBuilder(connectionString);
            builder.Database = "postgres"; // Default database
            return builder.ToString();
        }

        private static async Task CreateDatabaseIfNotExistsAsync(
            string serverConnectionString,
            string databaseName,
            ILogger logger,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(databaseName))
            {
                throw new ArgumentException("Database name must be configured.", nameof(databaseName));
            }

            try
            {
                await using var connection = new NpgsqlConnection(serverConnectionString);
                await connection.OpenAsync(cancellationToken);

                const string checkDbQuery = "SELECT 1 FROM pg_database WHERE datname = @databaseName";
                await using var checkCommand = new NpgsqlCommand(checkDbQuery, connection);
                checkCommand.Parameters.AddWithValue("databaseName", databaseName);
                var exists = await checkCommand.ExecuteScalarAsync(cancellationToken) != null;

                if (!exists)
                {
                    logger.LogInformation($"📦 Creating database '{databaseName}'...");
                    var createDbQuery = $"CREATE DATABASE {QuoteIdentifier(databaseName)}";
                    await using var createCommand = new NpgsqlCommand(createDbQuery, connection);
                    await createCommand.ExecuteNonQueryAsync(cancellationToken);
                    logger.LogInformation($"✅ Database '{databaseName}' created successfully");
                }
                else
                {
                    logger.LogInformation($"✅ Database '{databaseName}' already exists");
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, $"❌ Failed to create database '{databaseName}'");
                throw;
            }
        }

        private static string QuoteIdentifier(string identifier)
        {
            return "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
        }

        public static async Task WaitForRedisAsync(
            Func<Task> testConnection,
            ILogger logger,
            CancellationToken cancellationToken)
        {
            await WaitForDependencyAsync(
                testConnection,
                "Redis",
                logger,
                cancellationToken);
        }

        public static async Task WaitForRabbitMqAsync(
            Func<Task> testConnection,
            ILogger logger,
            CancellationToken cancellationToken)
        {
            await WaitForDependencyAsync(
                testConnection,
                "RabbitMQ",
                logger,
                cancellationToken);
        }

        private static async Task WaitForDependencyAsync(
            Func<Task> testConnection,
            string dependencyName,
            ILogger logger,
            CancellationToken cancellationToken)
        {
            var stopwatch = Stopwatch.StartNew();
            int attempt = 0;

            while (attempt < MaxRetries)
            {
                try
                {
                    logger.LogInformation($"⏳ Attempt {attempt + 1}/{MaxRetries}: Checking {dependencyName}...");
                    await testConnection();
                    stopwatch.Stop();
                    logger.LogInformation($"✅ {dependencyName} is ready! Connected in {stopwatch.ElapsedMilliseconds}ms");
                    return;
                }
                catch (Exception ex)
                {
                    attempt++;
                    if (attempt >= MaxRetries)
                    {
                        logger.LogError(ex, $"❌ Failed to connect to {dependencyName} after {MaxRetries} attempts");
                        throw new InvalidOperationException($"{dependencyName} is not available", ex);
                    }
                    logger.LogWarning($"⚠️ {dependencyName} not ready yet. Retrying in {DelayMs}ms...");
                    await Task.Delay(DelayMs, cancellationToken);
                }
            }
        }
    }
}

namespace Planora.BuildingBlocks.Infrastructure.Messaging;

public sealed class RabbitMqConnectionManager : IRabbitMqConnectionManager, IDisposable
{
    private readonly IConfiguration _configuration;
    private readonly ILogger<RabbitMqConnectionManager> _logger;
    private IConnection? _connection;
    private bool _disposed;
    private readonly SemaphoreSlim _semaphore = new(1, 1);

    public RabbitMqConnectionManager(
        IConfiguration configuration,
        ILogger<RabbitMqConnectionManager> logger)
    {
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    public async Task<IConnection> GetConnectionAsync(CancellationToken cancellationToken = default)
    {
        if (_connection != null && _connection.IsOpen)
            return _connection;

        await _semaphore.WaitAsync(cancellationToken);

        try
        {
            if (_connection != null && _connection.IsOpen)
                return _connection;

            _logger.LogInformation("Creating RabbitMQ connection...");

            var hostEnv = Environment.GetEnvironmentVariable("RABBITMQ_HOST");
            var portEnv = Environment.GetEnvironmentVariable("RABBITMQ_PORT");
            var userEnv = Environment.GetEnvironmentVariable("RABBITMQ_USER");
            var passEnv = Environment.GetEnvironmentVariable("RABBITMQ_PASSWORD");

            var host = hostEnv ?? _configuration["RabbitMQ:HostName"] ?? _configuration["RabbitMq:HostName"] ?? "localhost";
            var portStr = portEnv ?? _configuration["RabbitMQ:Port"] ?? _configuration["RabbitMq:Port"];
            var user = userEnv ?? _configuration["RabbitMQ:UserName"] ?? _configuration["RabbitMq:UserName"] ?? "guest";
            var pass = passEnv ?? _configuration["RabbitMQ:Password"] ?? _configuration["RabbitMq:Password"] ?? "guest";
            var vhost = _configuration["RabbitMQ:VirtualHost"] ?? _configuration["RabbitMq:VirtualHost"] ?? "/";

            int port = 5672;
            if (!string.IsNullOrWhiteSpace(portStr) && int.TryParse(portStr, out var p)) port = p;

            var factory = new ConnectionFactory
            {
                HostName = host,
                Port = port,
                UserName = user,
                Password = pass,
                VirtualHost = vhost,
                AutomaticRecoveryEnabled = true,
                NetworkRecoveryInterval = TimeSpan.FromSeconds(10),
                RequestedHeartbeat = TimeSpan.FromSeconds(60)
            };

            try
            {
                _connection = await factory.CreateConnectionAsync();
            }
            catch (Exception ex)
            {
                _connection = null;
                _logger.LogError(ex, "Failed to create RabbitMQ connection");
                throw;
            }

            if (_connection != null && _connection.IsOpen)
            {
                _logger.LogInformation("RabbitMQ connection established");
                return _connection;
            }
            throw new InvalidOperationException("RabbitMQ connection is not open");
        }
        finally
        {
            _semaphore.Release();
        }
    }

    public async Task CloseAsync()
    {
        if (_connection is not null)
        {
            try
            {
                if (_connection.IsOpen)
                {
                    await _connection.CloseAsync(200, "Closing", TimeSpan.FromSeconds(5), abort: false);
                    _logger.LogInformation("RabbitMQ connection closed");
                }
            }
            catch { }
        }
        await Task.CompletedTask;
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        CloseAsync().GetAwaiter().GetResult();
        _connection?.Dispose();
        _semaphore.Dispose();
        _disposed = true;
    }
}

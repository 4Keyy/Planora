using Planora.BuildingBlocks.Infrastructure.Messaging;
using Microsoft.Extensions.Hosting;

namespace Planora.Auth.Infrastructure.Services.Messaging;

public sealed class RabbitMqStartupHostedService : BackgroundService
{
    private readonly IRabbitMqConnectionManager _connectionManager;
    private readonly ILogger<RabbitMqStartupHostedService> _logger;
    private readonly TimeSpan _retryInterval = TimeSpan.FromSeconds(15);

    public RabbitMqStartupHostedService(
        IRabbitMqConnectionManager connectionManager,
        ILogger<RabbitMqStartupHostedService> logger)
    {
        _connectionManager = connectionManager;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var timer = new PeriodicTimer(_retryInterval);
        _logger.LogInformation("RabbitMQ background connection manager started");

        // First attempt immediately
        await TryConnectAsync(stoppingToken);

        try
        {
            while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken))
            {
                await TryConnectAsync(stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // Expected when stopping
            _logger.LogInformation("RabbitMQ connection manager stopping");
        }
        finally
        {
            timer.Dispose();
        }
    }

    private async Task TryConnectAsync(CancellationToken ct)
    {
        try
        {
            var conn = await _connectionManager.GetConnectionAsync(ct);
            if (conn is null || !conn.IsOpen)
            {
                _logger.LogWarning("RabbitMQ connection not established yet. Will retry in {RetrySeconds}s", (int)_retryInterval.TotalSeconds);
            }
            else
            {
                _logger.LogInformation("RabbitMQ connection is established and open");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "RabbitMQ connection attempt failed. Service will continue and retry");
        }
    }
}

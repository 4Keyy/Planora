namespace Planora.BuildingBlocks.Infrastructure.Messaging;

public interface IRabbitMqConnectionManager
{
    Task<IConnection> GetConnectionAsync(CancellationToken cancellationToken = default);
    Task CloseAsync();
}

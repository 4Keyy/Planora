namespace Planora.Realtime.Infrastructure.Services
{
    public interface IConnectionManager
    {
        Task AddConnectionAsync(string userId, string connectionId);
        Task RemoveConnectionAsync(string userId, string connectionId);
        List<string> GetUserConnections(string userId);
        int GetTotalConnections();
    }
}

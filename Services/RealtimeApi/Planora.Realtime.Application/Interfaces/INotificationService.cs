using System.Threading;
using System.Threading.Tasks;

namespace Planora.Realtime.Application.Interfaces
{
    public interface INotificationService
    {
        Task SendNotificationAsync(string userId, string message, string type, CancellationToken cancellationToken = default);
        Task SendToAllAsync(string message, string type, CancellationToken cancellationToken = default);
        Task SendToGroupAsync(string groupName, string message, string type, CancellationToken cancellationToken = default);
    }
}

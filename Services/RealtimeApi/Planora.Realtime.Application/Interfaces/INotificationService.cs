using System.Threading;
using System.Threading.Tasks;
using Planora.Realtime.Application.Response;

namespace Planora.Realtime.Application.Interfaces
{
    public interface INotificationService
    {
        /// <summary>
        /// Pushes a fully-shaped, persisted notification to its recipient's <c>user:{id}</c> group
        /// (<c>ReceiveNotification</c>). The payload carries the durable id + task routing so the
        /// client can render the toast, light the right card/branch unread indicator, and decide on
        /// an OS notification — all without a follow-up fetch.
        /// </summary>
        Task SendToUserAsync(NotificationPayload payload, CancellationToken cancellationToken = default);

        Task SendNotificationAsync(string userId, string message, string type, CancellationToken cancellationToken = default);
        Task SendToAllAsync(string message, string type, CancellationToken cancellationToken = default);
        Task SendToGroupAsync(string groupName, string message, string type, CancellationToken cancellationToken = default);
    }
}

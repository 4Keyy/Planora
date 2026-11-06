using Grpc.Core;
using Planora.GrpcContracts;
using Planora.Realtime.Application.Interfaces;

namespace Planora.Realtime.Infrastructure.Grpc
{
    /// <summary>
    /// Authorizes branch-room joins by delegating to TodoApi over gRPC. Reuses the existing
    /// <c>CheckTaskCommentAccess</c> RPC — the same authority that gates who may read a task's
    /// comments — so the "who can see this branch" rule lives in exactly one place (the task
    /// aggregate). The <c>x-service-key</c> header is injected by the shared
    /// <see cref="Planora.BuildingBlocks.Infrastructure.Grpc.ServiceKeyClientInterceptor"/>
    /// registered on the channel (INV-COMM-2).
    /// </summary>
    public sealed class TaskBranchAuthorizer : ITaskBranchAuthorizer
    {
        private readonly TodoService.TodoServiceClient _client;
        private readonly ILogger<TaskBranchAuthorizer> _logger;

        public TaskBranchAuthorizer(
            TodoService.TodoServiceClient client,
            ILogger<TaskBranchAuthorizer> logger)
        {
            _client = client;
            _logger = logger;
        }

        public async Task<bool> CanAccessBranchAsync(
            Guid taskId,
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            var response = await CheckAccessAsync(taskId, userId, cancellationToken);
            return response is { Exists: true, HasAccess: true };
        }

        public async Task<IReadOnlyList<Guid>?> GetAudienceAsync(
            Guid taskId,
            Guid requesterId,
            CancellationToken cancellationToken = default)
        {
            var response = await CheckAccessAsync(taskId, requesterId, cancellationToken);
            if (response is null)
                return null;
            if (!response.Exists || !response.HasAccess)
                return Array.Empty<Guid>();

            return response.ParticipantIds
                .Select(id => Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty)
                .Where(id => id != Guid.Empty)
                .Distinct()
                .ToArray();
        }

        private async Task<CheckTaskCommentAccessResponse?> CheckAccessAsync(
            Guid taskId,
            Guid userId,
            CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (taskId == Guid.Empty || userId == Guid.Empty)
                return new CheckTaskCommentAccessResponse();

            try
            {
                var response = await _client.CheckTaskCommentAccessAsync(
                    new CheckTaskCommentAccessRequest
                    {
                        TaskId = taskId.ToString(),
                        RequesterId = userId.ToString(),
                    },
                    cancellationToken: cancellationToken);

                return response;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (RpcException ex) when (ex.StatusCode == StatusCode.Cancelled && cancellationToken.IsCancellationRequested)
            {
                throw new OperationCanceledException(cancellationToken);
            }
            catch (RpcException ex)
            {
                // Fail closed for both joins and delivery, while distinguishing an outage from
                // an authoritative revocation so existing subscriptions can resume afterwards.
                _logger.LogWarning(
                    ex,
                    "Todo gRPC unavailable while authorizing branch access for task {TaskId}, user {UserId}: Status={Status}",
                    taskId, userId, ex.StatusCode);
                return null;
            }
        }
    }
}

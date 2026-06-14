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
            if (taskId == Guid.Empty || userId == Guid.Empty)
                return false;

            try
            {
                var response = await _client.CheckTaskCommentAccessAsync(
                    new CheckTaskCommentAccessRequest
                    {
                        TaskId = taskId.ToString(),
                        RequesterId = userId.ToString(),
                    },
                    cancellationToken: cancellationToken);

                return response.Exists && response.HasAccess;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (RpcException ex)
            {
                // Fail closed: if Todo can't authorize the join, the room is not entered. A user
                // who should have access can simply reopen the branch once Todo is reachable again.
                _logger.LogWarning(
                    ex,
                    "Todo gRPC unavailable while authorizing branch join for task {TaskId}, user {UserId}: Status={Status}",
                    taskId, userId, ex.StatusCode);
                return false;
            }
        }
    }
}

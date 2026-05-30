using Grpc.Core;
using Planora.Collaboration.Application.Exceptions;
using Planora.Collaboration.Application.Services;
using Planora.GrpcContracts;

namespace Planora.Collaboration.Infrastructure.Grpc
{
    /// <summary>
    /// Authorises comment operations by delegating to TodoApi over gRPC. TodoApi owns the task
    /// aggregate and the ownership / sharing / public + friendship rules; this client never reads
    /// Todo's database (INV-OWN-1). The <c>x-service-key</c> header is injected by the shared
    /// <see cref="Planora.BuildingBlocks.Infrastructure.Grpc.ServiceKeyClientInterceptor"/>
    /// registered on the channel (INV-COMM-2).
    /// </summary>
    public sealed class TaskAccessGrpcClient : ITaskAccessService
    {
        private readonly TodoService.TodoServiceClient _client;
        private readonly ILogger<TaskAccessGrpcClient> _logger;

        public TaskAccessGrpcClient(
            TodoService.TodoServiceClient client,
            ILogger<TaskAccessGrpcClient> logger)
        {
            _client = client ?? throw new ArgumentNullException(nameof(client));
            _logger = logger ?? throw new ArgumentNullException(nameof(logger));
        }

        public async Task<TaskAccessResult> CheckCommentAccessAsync(
            Guid taskId,
            Guid requesterId,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var response = await _client.CheckTaskCommentAccessAsync(
                    new CheckTaskCommentAccessRequest
                    {
                        TaskId = taskId.ToString(),
                        RequesterId = requesterId.ToString(),
                    },
                    cancellationToken: cancellationToken);

                var participants = response.ParticipantIds
                    .Select(id => Guid.TryParse(id, out var parsed) ? parsed : Guid.Empty)
                    .Where(id => id != Guid.Empty)
                    .Distinct()
                    .ToList();

                Guid.TryParse(response.OwnerId, out var ownerId);

                return new TaskAccessResult(response.Exists, response.HasAccess, ownerId, participants);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (RpcException ex)
            {
                // Fail closed: Todo could not authorise the request. Surface a clean 503 (via the
                // shared DomainException → ProblemDetails mapping) instead of a raw gRPC fault.
                _logger.LogWarning(
                    ex,
                    "Todo gRPC unavailable while checking comment access for task {TaskId}, requester {RequesterId}: Status={Status}",
                    taskId, requesterId, ex.StatusCode);
                throw new ExternalServiceUnavailableException("TodoApi", "CheckTaskCommentAccess", ex);
            }
        }
    }
}


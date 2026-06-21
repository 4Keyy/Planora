using Grpc.Core;
using Planora.GrpcContracts;

namespace Planora.Messaging.Api.Grpc;

/// <summary>
/// Messaging over gRPC carries no verified caller identity: <c>SendMessageRequest.SenderId</c> and
/// <c>GetMessagesRequest.UserId</c> are client-supplied. Honouring them would let any caller send a
/// message as another user (sender spoofing) or read any two users' private conversation (IDOR).
/// There is no internal gRPC caller — messaging is performed through the authenticated HTTP API —
/// so both methods fail closed instead of trusting the request body.
/// </summary>
public class MessagingGrpcService : MessagingService.MessagingServiceBase
{
    private readonly ILogger<MessagingGrpcService> _logger;

    public MessagingGrpcService(ILogger<MessagingGrpcService> logger)
    {
        _logger = logger;
    }

    public override Task<Planora.GrpcContracts.SendMessageResponse> SendMessage(SendMessageRequest request, ServerCallContext context)
    {
        _logger.LogWarning("Refused gRPC SendMessage: messaging is not exposed over gRPC.");
        throw new RpcException(new global::Grpc.Core.Status(
            global::Grpc.Core.StatusCode.PermissionDenied,
            "Messaging is not available over gRPC; use the authenticated HTTP API."));
    }

    public override Task<GetMessagesResponse> GetMessages(GetMessagesRequest request, ServerCallContext context)
    {
        _logger.LogWarning("Refused gRPC GetMessages: messaging is not exposed over gRPC.");
        throw new RpcException(new global::Grpc.Core.Status(
            global::Grpc.Core.StatusCode.PermissionDenied,
            "Messaging is not available over gRPC; use the authenticated HTTP API."));
    }
}

using Grpc.Core;
using Planora.GrpcContracts;
using Planora.Realtime.Application.Interfaces;
using MediatR;

namespace Planora.Realtime.Api.Grpc;

public class RealtimeGrpcService : RealtimeService.RealtimeServiceBase
{
    private readonly INotificationService _notificationService;
    private readonly ILogger<RealtimeGrpcService> _logger;

    public RealtimeGrpcService(INotificationService notificationService, ILogger<RealtimeGrpcService> logger)
    {
        _notificationService = notificationService;
        _logger = logger;
    }

    public override async Task<SendNotificationResponse> SendNotification(SendNotificationRequest request, ServerCallContext context)
    {
        _logger.LogInformation("Sending notification to user {UserId}: {Message}", request.UserId, request.Message);

        await _notificationService.SendNotificationAsync(request.UserId, request.Message, request.Type, context.CancellationToken);

        return new SendNotificationResponse
        {
            Success = true
        };
    }

    public override async Task<BroadcastNotificationResponse> BroadcastNotification(BroadcastNotificationRequest request, ServerCallContext context)
    {
        _logger.LogInformation("Broadcasting notification: {Message}", request.Message);

        await _notificationService.SendToAllAsync(request.Message, request.Type, context.CancellationToken);

        return new BroadcastNotificationResponse
        {
            Success = true
        };
    }
}

using Grpc.Core;
using Planora.GrpcContracts;
using Planora.Messaging.Application.Features.Messages.Commands.SendMessage;
using Planora.Messaging.Application.Features.Messages.Queries.GetMessages;
using MediatR;

namespace Planora.Messaging.Api.Grpc;

public class MessagingGrpcService : MessagingService.MessagingServiceBase
{
    private readonly IMediator _mediator;
    private readonly ILogger<MessagingGrpcService> _logger;

    public MessagingGrpcService(IMediator mediator, ILogger<MessagingGrpcService> logger)
    {
        _mediator = mediator;
        _logger = logger;
    }

    public override async Task<Planora.GrpcContracts.SendMessageResponse> SendMessage(SendMessageRequest request, ServerCallContext context)
    {
        var command = new SendMessageCommand(
            string.IsNullOrEmpty(request.SenderId) ? null : Guid.Parse(request.SenderId),
            "No Subject",
            request.Content,
            Guid.Parse(request.ReceiverId));

        var result = await _mediator.Send(command);

        return new Planora.GrpcContracts.SendMessageResponse
        {
            Id = result.MessageId.ToString()
        };
    }

    public override async Task<GetMessagesResponse> GetMessages(GetMessagesRequest request, ServerCallContext context)
    {
        var query = new GetMessagesQuery(Guid.Parse(request.UserId), Guid.Parse(request.OtherUserId), request.Page, request.PageSize);
        var result = await _mediator.Send(query);

        var response = new GetMessagesResponse
        {
            TotalCount = result.TotalCount
        };

        response.Messages.AddRange(result.Items.Select(m => new MessageModel
        {
            Id = m.Id.ToString(),
            SenderId = m.SenderId.ToString(),
            ReceiverId = m.RecipientId.ToString(),
            Content = m.Body,
            CreatedAt = m.CreatedAt.ToString(),
            IsRead = m.ReadAt.HasValue
        }));

        return response;
    }
}

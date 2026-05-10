using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.Messaging.Application.DTOs;
using Planora.Messaging.Domain;

namespace Planora.Messaging.Application.Features.Messages.Queries.GetMessages;

public class GetMessagesQueryHandler : IQueryHandler<GetMessagesQuery, PagedResult<MessageDto>>
{
    private readonly IMessageRepository _messageRepository;

    public GetMessagesQueryHandler(IMessageRepository messageRepository)
    {
        _messageRepository = messageRepository;
    }

    public async Task<PagedResult<MessageDto>> Handle(GetMessagesQuery request, CancellationToken cancellationToken)
    {
        var (safePage, safePageSize) = PaginationParameters.Normalize(request.Page, request.PageSize);
        var (pagedMessages, totalCount) = await _messageRepository.GetConversationPagedAsync(
            request.UserId,
            request.OtherUserId,
            safePage,
            safePageSize,
            cancellationToken);

        var dtos = pagedMessages
            .Select(m => new MessageDto
            {
                Id = m.Id,
                Subject = m.Subject,
                Body = m.Body,
                SenderId = m.SenderId,
                RecipientId = m.RecipientId,
                ReadAt = m.ReadAt,
                IsArchived = m.IsArchived,
                CreatedAt = m.CreatedAt
            })
            .ToList();

        return new PagedResult<MessageDto>(dtos, safePage, safePageSize, totalCount);
    }
}

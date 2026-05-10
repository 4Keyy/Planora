using Planora.BuildingBlocks.Application.CQRS;
using Planora.BuildingBlocks.Application.Pagination;
using Planora.Messaging.Application.DTOs;

namespace Planora.Messaging.Application.Features.Messages.Queries.GetMessages;

public sealed record GetMessagesQuery(
    Guid UserId,
    Guid OtherUserId,
    int Page,
    int PageSize) : IQuery<PagedResult<MessageDto>>;

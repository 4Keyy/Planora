using Planora.BuildingBlocks.Application.Persistence;
using Planora.BuildingBlocks.Domain.Exceptions;
using Planora.BuildingBlocks.Application.Messaging.Events;
using Planora.BuildingBlocks.Application.Outbox;
using Planora.Messaging.Application.Common;
using Planora.Messaging.Application.Services;
using Planora.Messaging.Domain;

namespace Planora.Messaging.Application.Features.Messages.Commands.SendMessage
{
    public sealed class SendMessageHandler : IRequestHandler<SendMessageCommand, SendMessageResponse>
    {
        private readonly IMessageRepository _repository;
        private readonly ILogger<SendMessageHandler> _logger;
        private readonly ICurrentUserService _currentUserService;
        private readonly IFriendshipService _friendshipService;
        private readonly IOutboxRepository _outbox;

        public SendMessageHandler(
            IMessageRepository repository,
            ILogger<SendMessageHandler> logger,
            ICurrentUserService currentUserService,
            IFriendshipService friendshipService,
            IOutboxRepository outbox)
        {
            _repository = repository;
            _logger = logger;
            _currentUserService = currentUserService;
            _friendshipService = friendshipService;
            _outbox = outbox;
        }

        public async Task<SendMessageResponse> Handle(SendMessageCommand request, CancellationToken cancellationToken)
        {
            var currentUserId = _currentUserService.UserId;
            if (currentUserId.HasValue && request.SenderId.HasValue && currentUserId.Value != request.SenderId.Value)
            {
                throw new ForbiddenException(
                    "Cannot send a message as another user.",
                    "MESSAGING.SENDER_MISMATCH");
            }

            var senderId = currentUserId ?? request.SenderId ?? throw new InvalidOperationException("User not authenticated");

            var areFriends = await _friendshipService.AreFriendsAsync(senderId, request.RecipientId, cancellationToken);
            if (!areFriends)
            {
                throw new ForbiddenException(
                    "Messages can only be sent to accepted friends.",
                    "MESSAGING.FRIENDSHIP_REQUIRED");
            }

            var message = new Message(request.Subject, request.Body, senderId, request.RecipientId);

            // Track the message but do NOT save yet: enqueuing the integration event below commits the
            // message row and the outbox row in a single SaveChanges, so the recipient's notification is
            // never lost if the broker is briefly down (transactional outbox, INV-COMM-3 / at-least-once).
            await _repository.AddAsync(message, cancellationToken);

            await _outbox.EnqueueIntegrationEventAsync(
                new NotificationEvent(
                    request.RecipientId,
                    "New message",
                    $"New message: {request.Subject}",
                    "MessageReceived"),
                cancellationToken);

            _logger.LogInformation("Message {MessageId} sent from {SenderId} to {RecipientId}",
                message.Id, senderId, request.RecipientId);

            return new SendMessageResponse(message.Id, message.CreatedAt);
        }
    }
}

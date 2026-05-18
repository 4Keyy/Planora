namespace Planora.BuildingBlocks.Infrastructure.Messaging.Events
{
    public sealed class FriendshipRemovedIntegrationEvent : IntegrationEvent
    {
        public Guid UserId { get; init; }
        public Guid FriendId { get; init; }

        public FriendshipRemovedIntegrationEvent(Guid userId, Guid friendId)
        {
            UserId = userId;
            FriendId = friendId;
        }
    }
}

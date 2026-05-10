namespace Planora.BuildingBlocks.Infrastructure.Messaging.Events
{
    public sealed class CategoryDeletedIntegrationEvent : IntegrationEvent
    {
        public Guid CategoryId { get; init; }
        public Guid UserId { get; init; }

        public CategoryDeletedIntegrationEvent(Guid categoryId, Guid userId)
        {
            CategoryId = categoryId;
            UserId = userId;
        }
    }
}


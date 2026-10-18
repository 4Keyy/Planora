namespace Planora.Todo.Application.DTOs
{
    public sealed record FriendAffinityDto
    {
        public required Guid FriendId { get; init; }
        public required double Score { get; init; }
        public required int SharedByMe { get; init; }
        public required int SharedWithMe { get; init; }
    }
}

namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriendRequests
{
    public sealed class FriendRequestDto
    {
        public Guid FriendshipId { get; set; }
        public Guid UserId { get; set; }
        public string Email { get; set; } = string.Empty;
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string? ProfilePictureUrl { get; set; }
        public DateTime RequestedAt { get; set; }
        public string Status { get; set; } = string.Empty;
    }
}


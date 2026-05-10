namespace Planora.Auth.Application.Features.Friendships.Queries.GetFriends
{
    public sealed class FriendDto
    {
        public Guid Id { get; set; }
        public string Email { get; set; } = string.Empty;
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string? ProfilePictureUrl { get; set; }
        public DateTime FriendsSince { get; set; }
    }
}


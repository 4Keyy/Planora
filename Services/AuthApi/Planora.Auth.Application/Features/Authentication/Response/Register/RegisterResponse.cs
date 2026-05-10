using System.Text.Json.Serialization;

namespace Planora.Auth.Application.Features.Authentication.Response.Register
{
    public sealed record RegisterResponse
    {
        public Guid UserId { get; init; }
        public string Email { get; init; } = string.Empty;
        public string FirstName { get; init; } = string.Empty;
        public string LastName { get; init; } = string.Empty;
        public string AccessToken { get; init; } = string.Empty;

        [JsonIgnore]
        public string RefreshToken { get; init; } = string.Empty;

        public DateTime ExpiresAt { get; init; }
    }
}

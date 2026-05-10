namespace Planora.Auth.Application.Common.DTOs
{
    public sealed record UpdateUserDto
    {
        public string FirstName { get; init; } = string.Empty;

        public string LastName { get; init; } = string.Empty;

        public string? ProfilePictureUrl { get; init; }
    }
}

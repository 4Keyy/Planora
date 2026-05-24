namespace Planora.BuildingBlocks.Infrastructure.Context
{
    public interface ICurrentUserContext
    {
        Guid UserId { get; }
        string? Email { get; }
        string? Name { get; }
        string? ProfilePictureUrl { get; }
        IReadOnlyList<string> Roles { get; }
        bool IsAuthenticated { get; }
    }
}

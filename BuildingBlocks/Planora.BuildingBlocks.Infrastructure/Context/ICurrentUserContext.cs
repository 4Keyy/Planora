namespace Planora.BuildingBlocks.Infrastructure.Context
{
    public interface ICurrentUserContext
    {
        Guid UserId { get; }
        string? Email { get; }
        IReadOnlyList<string> Roles { get; }
        bool IsAuthenticated { get; }
    }
}

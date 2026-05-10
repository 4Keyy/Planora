namespace Planora.Auth.Application.Common.Interfaces
{
    public interface ICurrentUserService
    {
        Guid? UserId { get; }

        string? Email { get; }

        string? IpAddress { get; }

        string? UserAgent { get; }

        bool IsAuthenticated { get; }

        IEnumerable<string> Roles { get; }

        IDictionary<string, string> Claims { get; }
    }
}

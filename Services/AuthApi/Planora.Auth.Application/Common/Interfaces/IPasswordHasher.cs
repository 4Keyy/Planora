namespace Planora.Auth.Application.Common.Interfaces
{
    public interface IPasswordHasher
    {
        string HashPassword(string password);

        bool VerifyPassword(string password, string passwordHash);

        bool NeedsRehash(string passwordHash);
    }
}

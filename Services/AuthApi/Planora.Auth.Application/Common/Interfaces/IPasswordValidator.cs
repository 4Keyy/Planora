namespace Planora.Auth.Application.Common.Interfaces
{
    public interface IPasswordValidator
    {
        bool IsStrongPassword(string password);

        Task<bool> IsPasswordCompromisedAsync(string password, CancellationToken cancellationToken = default);

        Task<bool> IsDifferentFromPreviousPasswordsAsync(
            Guid userId,
            string newPasswordHash,
            int count = 5,
            CancellationToken cancellationToken = default);
    }
}

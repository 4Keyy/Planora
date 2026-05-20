namespace Planora.Auth.Application.Common.Interfaces
{
    public interface IRecoveryCodeService
    {
        Task<IReadOnlyList<string>> GenerateAndStoreCodesAsync(
            Guid userId,
            CancellationToken cancellationToken = default);

        Task<bool> ValidateAndConsumeCodeAsync(
            Guid userId,
            string code,
            CancellationToken cancellationToken = default);
    }
}

namespace Planora.Auth.Application.Common.Interfaces;

public interface ITokenBlacklistService
{
    Task<bool> IsTokenBlacklistedAsync(string token, CancellationToken cancellationToken = default);
    Task BlacklistTokenAsync(string token, TimeSpan expiration, CancellationToken cancellationToken = default);
    Task RemoveExpiredTokensAsync(CancellationToken cancellationToken = default);
}
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;

namespace Planora.Auth.Application.Features.Authentication.Handlers.RefreshToken
{
    public sealed class RefreshTokenCommandHandler : IRequestHandler<RefreshTokenCommand, Result<TokenDto>>
    {
        // Mirror of RefreshTokenCommandHandler's own rotation reason — kept in sync
        // with the call to refreshToken.Revoke(..., "Replaced by new token", ...).
        // Detecting this exact reason on a presented refresh token tells us the
        // legitimate client already rotated past this value; any presenter is a
        // replay attack and we must invalidate the entire chain.
        private const string RotationRevokeReason = "Replaced by new token";
        private const string ReuseDetectedReason = "Reuse detected — chain invalidated";

        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ITokenService _tokenService;
        private readonly ICurrentUserService _currentUserService;
        private readonly ISecurityStampService _securityStamp;
        private readonly ILogger<RefreshTokenCommandHandler> _logger;

        public RefreshTokenCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ITokenService tokenService,
            ICurrentUserService currentUserService,
            ISecurityStampService securityStamp,
            ILogger<RefreshTokenCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _tokenService = tokenService;
            _currentUserService = currentUserService;
            _securityStamp = securityStamp;
            _logger = logger;
        }

        public async Task<Result<TokenDto>> Handle(
            RefreshTokenCommand command,
            CancellationToken cancellationToken)
        {
            try
            {
                // Load user WITH refresh tokens in ONE query
                // This ensures proper EF tracking and avoids concurrency issues
                var user = await _unitOfWork.Users.GetByRefreshTokenAsync(command.RefreshToken, cancellationToken);

                if (user == null)
                {
                    _logger.LogWarning("User not found for refresh token");
                    return Result.Failure<TokenDto>(
                        Error.NotFound("INVALID_REFRESH_TOKEN", "Refresh token not found or expired"));
                }

                // Get the refresh token from user's collection (properly tracked)
                var refreshToken = user.RefreshTokens.FirstOrDefault(rt => rt.Token == command.RefreshToken);

                if (refreshToken == null)
                {
                    _logger.LogWarning("Refresh token row not found on user: {UserId}", user.Id);
                    return Result.Failure<TokenDto>(
                        Error.Unauthorized("INVALID_REFRESH_TOKEN", "Refresh token is no longer valid"));
                }

                // SECURITY: refresh-token reuse detection. If this token was already rotated
                // by the legitimate client (revoked with RotationRevokeReason), the presenter
                // is either an attacker replaying a stolen value or a buggy client racing its
                // own refresh. Either way, the safe response is to invalidate every active
                // refresh token for this user AND rotate the security stamp so any already-
                // minted access tokens become invalid on their next authenticated call.
                if (refreshToken.IsRevoked
                    && string.Equals(refreshToken.RevokedReason, RotationRevokeReason, StringComparison.Ordinal))
                {
                    var attackerIp = _currentUserService.IpAddress ?? "unknown";
                    _logger.LogWarning(
                        "Refresh-token reuse detected for user {UserId} from IP {Ip}; revoking chain and rotating stamp.",
                        user.Id, attackerIp);

                    foreach (var live in user.RefreshTokens.Where(rt => rt.IsActive).ToList())
                    {
                        live.Revoke(attackerIp, ReuseDetectedReason);
                        _unitOfWork.RefreshTokens.Update(live);
                    }
                    await _unitOfWork.SaveChangesAsync(cancellationToken);
                    await _securityStamp.SetStampAsync(user.Id, cancellationToken);

                    return Result.Failure<TokenDto>(
                        Error.Unauthorized("INVALID_REFRESH_TOKEN", "Refresh token is no longer valid"));
                }

                if (!refreshToken.IsActive)
                {
                    _logger.LogWarning(
                        "Refresh token not active: User: {UserId}",
                        user.Id);

                    return Result.Failure<TokenDto>(
                        Error.Unauthorized("INVALID_REFRESH_TOKEN", "Refresh token is no longer valid"));
                }

                if (user.IsLocked())
                {
                    _logger.LogWarning("Attempt to refresh token for locked user: {UserId}", user.Id);
                    return Result.Failure<TokenDto>(
                        Error.Forbidden("USER_LOCKED", "Account is locked"));
                }

                var ipAddress = _currentUserService.IpAddress ?? "unknown";
                
                var newAccessToken = _tokenService.GenerateAccessToken(user);
                var newRefreshTokenValue = _tokenService.GenerateRefreshToken();
                var newRefreshTokenExpiry = DateTime.UtcNow.Add(_tokenService.GetRefreshTokenLifetime());

                // Manually revoke ONLY current token to avoid EF tracking conflicts
                refreshToken.Revoke(ipAddress, "Replaced by new token", string.Empty);
                _unitOfWork.RefreshTokens.Update(refreshToken);

                // Create new refresh token directly, preserving the original RememberMe intent
                // and inheriting device association from the rotated token (both params are string?)
                var newRefreshToken = new RefreshTokenEntity(
                    user.Id,
                    newRefreshTokenValue,
                    ipAddress,
                    newRefreshTokenExpiry,
                    refreshToken.RememberMe,
                    refreshToken.DeviceFingerprint,
                    refreshToken.DeviceName);
                await _unitOfWork.RefreshTokens.AddAsync(newRefreshToken, cancellationToken);

                await _unitOfWork.SaveChangesAsync(cancellationToken);

                _logger.LogInformation(
                    "Refresh token rotated for user: {UserId}",
                    user.Id);

                var response = new TokenDto
                {
                    AccessToken = newAccessToken,
                    RefreshToken = newRefreshToken.Token,
                    ExpiresAt = newRefreshTokenExpiry,
                    RememberMe = newRefreshToken.RememberMe
                };

                return Result.Success(response);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error refreshing token");
                return Result.Failure<TokenDto>(
                    Error.InternalServer("REFRESH_ERROR", "An error occurred while refreshing token"));
            }
        }
    }
}

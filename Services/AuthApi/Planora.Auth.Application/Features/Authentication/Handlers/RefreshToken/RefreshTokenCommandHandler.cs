using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Application.Features.Authentication.Commands.RefreshToken;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;

namespace Planora.Auth.Application.Features.Authentication.Handlers.RefreshToken
{
    public sealed class RefreshTokenCommandHandler : IRequestHandler<RefreshTokenCommand, Result<TokenDto>>
    {
        // The persisted reason identifies a rotated value for replay handling.
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
                var user = await _unitOfWork.Users.GetByRefreshTokenAsync(command.RefreshToken, cancellationToken);

                if (user == null)
                {
                    _logger.LogWarning("User not found for refresh token");
                    return Result.Failure<TokenDto>(
                        Error.NotFound("INVALID_REFRESH_TOKEN", "Refresh token not found or expired"));
                }

                // Get the refresh token from the user's snapshot. Tokens are stored
                // hashed, so match the presented raw value against the stored hash via Matches().
                var refreshToken = user.RefreshTokens.FirstOrDefault(rt => rt.Matches(command.RefreshToken));

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
                if (WasRotated(refreshToken))
                {
                    await InvalidateReusedChainAsync(user.Id, cancellationToken);
                    return InvalidToken();
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
                
                // A concurrent replay may rotate the security stamp as soon as this write commits.
                // The candidate access token must predate that stamp, and is returned only on commit.
                var newAccessToken = _tokenService.GenerateAccessToken(user);
                var newRefreshTokenValue = _tokenService.GenerateRefreshToken();
                var newRefreshTokenExpiry = DateTime.UtcNow.Add(_tokenService.GetRefreshTokenLifetime());

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
                if (!await _unitOfWork.RefreshTokens.TryRotateAsync(
                        refreshToken, newRefreshToken, RotationRevokeReason, cancellationToken))
                {
                    var latest = await _unitOfWork.Users.GetByRefreshTokenAsync(command.RefreshToken, cancellationToken);
                    if (latest != null && latest.RefreshTokens.Any(row => row.Matches(command.RefreshToken) && WasRotated(row)))
                        await InvalidateReusedChainAsync(latest.Id, cancellationToken);

                    return InvalidToken();
                }

                _logger.LogInformation(
                    "Refresh token rotated for user: {UserId}",
                    user.Id);

                var response = new TokenDto
                {
                    AccessToken = newAccessToken,
                    // Return the RAW token to the client; only its hash is stored on the entity.
                    RefreshToken = newRefreshTokenValue,
                    ExpiresAt = newRefreshTokenExpiry,
                    RememberMe = newRefreshToken.RememberMe
                };

                return Result.Success(response);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogError(ex, "Error refreshing token");
                return Result.Failure<TokenDto>(
                    Error.InternalServer("REFRESH_ERROR", "An error occurred while refreshing token"));
            }
        }

        private static bool WasRotated(RefreshTokenEntity token) =>
            token.IsRevoked && string.Equals(token.RevokedReason, RotationRevokeReason, StringComparison.Ordinal);

        private static Result<TokenDto> InvalidToken() =>
            Result.Failure<TokenDto>(Error.Unauthorized("INVALID_REFRESH_TOKEN", "Refresh token is no longer valid"));

        private async Task InvalidateReusedChainAsync(Guid userId, CancellationToken cancellationToken)
        {
            var attackerIp = _currentUserService.IpAddress ?? "unknown";
            _logger.LogWarning(
                "Refresh-token reuse detected for user {UserId} from IP {Ip}; revoking chain and rotating stamp.",
                userId, attackerIp);

            await _unitOfWork.RefreshTokens.RevokeActiveAfterReplayAsync(
                userId, attackerIp, ReuseDetectedReason,
                token => _securityStamp.SetStampAsync(userId, token), cancellationToken);
        }
    }
}

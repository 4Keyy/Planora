using Planora.Auth.Application.Features.Authentication.Commands.Login;
using Planora.Auth.Application.Features.Authentication.Response.Login;
using Planora.Auth.Domain.Entities;
using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Infrastructure.Services;
using Planora.BuildingBlocks.Domain.Exceptions;
using RefreshTokenEntity = Planora.Auth.Domain.Entities.RefreshToken;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Auth.Application.Features.Authentication.Handlers.Login
{
    public sealed class LoginCommandHandler : IRequestHandler<LoginCommand, BuildingBlocks.Domain.Result<LoginResponse>>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly ITokenService _tokenService;
        private readonly ITwoFactorService _twoFactorService;
        private readonly ICurrentUserService _currentUserService;
        private readonly IBusinessEventLogger _businessLogger;
        private readonly ILogger<LoginCommandHandler> _logger;

        public LoginCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ITokenService tokenService,
            ITwoFactorService twoFactorService,
            ICurrentUserService currentUserService,
            IBusinessEventLogger businessLogger,
            ILogger<LoginCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _tokenService = tokenService;
            _twoFactorService = twoFactorService;
            _currentUserService = currentUserService;
            _businessLogger = businessLogger;
            _logger = logger;
        }

        public async Task<BuildingBlocks.Domain.Result<LoginResponse>> Handle(
            LoginCommand command,
            CancellationToken cancellationToken)
        {
            Email email = Email.Create(command.Email);

            // Load user WITH refresh tokens to properly manage token lifecycle
            var user = await _unitOfWork.Users.GetByEmailAsync(email, cancellationToken);
            if (user == null)
            {
                _logger.LogWarning("Login attempt with non-existent email: {Email}", email.Value);
                throw new UnauthorizedAccessException("Invalid email or password");
            }

            // Reload with refresh tokens for proper token management
            user = await _unitOfWork.Users.GetWithRefreshTokensAsync(user.Id, cancellationToken);
            if (user == null)
            {
                throw new UnauthorizedAccessException("User not found");
            }

            if (user.IsLocked())
            {
                _logger.LogWarning("Login attempt for locked user: {UserId}", user.Id);
                throw new ForbiddenException("Account is locked. Please try again later.");
            }

            if (!_passwordHasher.VerifyPassword(command.Password, user.PasswordHash))
            {
                _logger.LogWarning("Invalid password for user: {UserId}", user.Id);
                await _unitOfWork.Users.HandleFailedLoginAsync(user.Id, cancellationToken);
                var failedLoginHistory = new LoginHistory(
                    user.Id,
                    _currentUserService.IpAddress ?? "unknown",
                    _currentUserService.UserAgent ?? "unknown",
                    false,
                    "Invalid password");
                await _unitOfWork.LoginHistory.AddAsync(failedLoginHistory, cancellationToken);
                await _unitOfWork.SaveChangesAsync(cancellationToken);

                throw new UnauthorizedAccessException("Invalid email or password");
            }

            if (user.TwoFactorEnabled)
            {
                if (string.IsNullOrEmpty(command.TwoFactorCode))
                {
                    throw new UnauthorizedAccessException("Two-factor authentication code is required");
                }

                if (!_twoFactorService.VerifyCode(user.TwoFactorSecret!, command.TwoFactorCode))
                {
                    _logger.LogWarning("Invalid 2FA code for user: {UserId}", user.Id);
                    await _unitOfWork.Users.HandleFailedLoginAsync(user.Id, cancellationToken);
                    var failedLoginHistory = new LoginHistory(
                        user.Id,
                        _currentUserService.IpAddress ?? "unknown",
                        _currentUserService.UserAgent ?? "unknown",
                        false,
                        "Invalid two-factor authentication code");
                    await _unitOfWork.LoginHistory.AddAsync(failedLoginHistory, cancellationToken);
                    await _unitOfWork.SaveChangesAsync(cancellationToken);

                    throw new UnauthorizedAccessException("Invalid two-factor authentication code");
                }
            }

            var accessToken = _tokenService.GenerateAccessToken(user);
            var refreshTokenValue = _tokenService.GenerateRefreshToken();
            var refreshTokenLifetime = command.RememberMe
                ? TimeSpan.FromDays(30)
                : _tokenService.GetRefreshTokenLifetime();
            var refreshTokenExpiry = DateTime.UtcNow.Add(refreshTokenLifetime);

            var userAgent = _currentUserService.UserAgent ?? "unknown";
            var ipAddress = _currentUserService.IpAddress ?? "unknown";
            var deviceFingerprint = ComputeDeviceFingerprint(userAgent, ipAddress);
            var deviceName = ParseDeviceName(userAgent);

            // Session deduplication — same device reuses the existing token record
            var existingToken = await _unitOfWork.RefreshTokens
                .FindActiveByUserAndDeviceAsync(user.Id, deviceFingerprint, cancellationToken);

            if (existingToken != null)
            {
                existingToken.UpdateForReLogin(refreshTokenValue, refreshTokenExpiry, command.RememberMe, ipAddress);
                _unitOfWork.RefreshTokens.Update(existingToken);
            }
            else
            {
                var newToken = new RefreshTokenEntity(
                    user.Id,
                    refreshTokenValue,
                    ipAddress,
                    refreshTokenExpiry,
                    command.RememberMe,
                    deviceFingerprint,
                    deviceName);
                await _unitOfWork.RefreshTokens.AddAsync(newToken, cancellationToken);
            }

            try
            {
                user.UpdateLastLogin();
                user.ResetFailedLoginAttempts();
                
                await _unitOfWork.SaveChangesAsync(cancellationToken);
            }
            catch (Exception ex) when (ex is Microsoft.EntityFrameworkCore.DbUpdateConcurrencyException)
            {
                _logger.LogError(ex, "Concurrency error during login for user {UserId}.", user.Id);
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error saving login data for user {UserId}: {Message}", user.Id, ex.Message);
                throw;
            }

            // Login history is a non-critical audit log — written after the main commit
            // so failures here never block the user from logging in
            try
            {
                var loginHistory = new LoginHistory(user.Id, ipAddress, userAgent, true);
                await _unitOfWork.LoginHistory.AddAsync(loginHistory, cancellationToken);
                await _unitOfWork.SaveChangesAsync(cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Login history write failed for user {UserId}; login continues.", user.Id);
            }

            _logger.LogInformation(
                "User logged in successfully: {UserId}, Email: {Email}",
                user.Id,
                user.Email.Value);

            // Log business event
            _businessLogger.LogBusinessEvent(
                UserLoggedIn,
                $"User {user.Id} logged in",
                new { UserId = user.Id, Email = user.Email.Value, IpAddress = _currentUserService.IpAddress },
                user.Id.ToString());

            var response = new LoginResponse
            {
                UserId = user.Id,
                Email = user.Email.Value,
                FirstName = user.FirstName,
                LastName = user.LastName,
                AccessToken = accessToken,
                RefreshToken = refreshTokenValue,
                ExpiresAt = refreshTokenExpiry,
                TwoFactorEnabled = user.TwoFactorEnabled
            };

            return BuildingBlocks.Domain.Result<LoginResponse>.Success(response);
        }

        // ---------------------------------------------------------------------------
        // Device fingerprint helpers
        // ---------------------------------------------------------------------------

        private static string ComputeDeviceFingerprint(string userAgent, string ipAddress)
        {
            var raw = $"{userAgent}|{ipAddress}";
            using var sha = System.Security.Cryptography.SHA256.Create();
            var bytes = sha.ComputeHash(System.Text.Encoding.UTF8.GetBytes(raw));
            return Convert.ToHexString(bytes).ToLower();
        }

        private static string ParseDeviceName(string? userAgent)
        {
            if (string.IsNullOrEmpty(userAgent)) return "Unknown Device";
            if (userAgent.Contains("Mobile", StringComparison.OrdinalIgnoreCase)) return "Mobile Browser";
            if (userAgent.Contains("Chrome", StringComparison.OrdinalIgnoreCase)) return "Chrome";
            if (userAgent.Contains("Firefox", StringComparison.OrdinalIgnoreCase)) return "Firefox";
            if (userAgent.Contains("Safari", StringComparison.OrdinalIgnoreCase)) return "Safari";
            return "Browser";
        }
    }
}

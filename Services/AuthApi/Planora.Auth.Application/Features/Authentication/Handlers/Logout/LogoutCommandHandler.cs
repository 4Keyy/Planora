using Planora.Auth.Application.Features.Authentication.Commands.Logout;

namespace Planora.Auth.Application.Features.Authentication.Handlers.Logout
{
    public sealed class LogoutCommandHandler : IRequestHandler<LogoutCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<LogoutCommandHandler> _logger;

        public LogoutCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ICurrentUserService currentUserService,
            ILogger<LogoutCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result> Handle(
            LogoutCommand command,
            CancellationToken cancellationToken)
        {
            try
            {
                if (string.IsNullOrEmpty(command.RefreshToken))
                {
                    _logger.LogInformation("User logged out without revoking refresh token");
                    return Result.Success();
                }

                var refreshToken = await _unitOfWork.RefreshTokens.GetByTokenAsync(
                    command.RefreshToken,
                    cancellationToken);

                if (refreshToken == null)
                {
                    _logger.LogWarning("Logout attempt with invalid refresh token");
                    return Result.Success();
                }

                if (refreshToken.IsActive)
                {
                    var ipAddress = _currentUserService.IpAddress ?? "unknown";
                    refreshToken.Revoke(ipAddress, "Logged out");

                    _unitOfWork.RefreshTokens.Update(refreshToken);
                    await _unitOfWork.SaveChangesAsync(cancellationToken);

                    _logger.LogInformation(
                        "User logged out and refresh token revoked: {UserId}",
                        refreshToken.UserId);
                }

                return Result.Success();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during logout");
                return Result.Failure(
                    Error.InternalServer("LOGOUT_ERROR", "An error occurred during logout"));
            }
        }
    }
}

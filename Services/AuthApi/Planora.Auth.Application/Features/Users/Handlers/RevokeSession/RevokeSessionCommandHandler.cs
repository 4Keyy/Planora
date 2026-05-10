using Planora.Auth.Application.Features.Users.Commands.RevokeSession;

namespace Planora.Auth.Application.Features.Users.Handlers.RevokeSession
{
    public sealed class RevokeSessionCommandHandler : IRequestHandler<RevokeSessionCommand, Result>
    {
        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly ICurrentUserService _currentUserService;
        private readonly ILogger<RevokeSessionCommandHandler> _logger;

        public RevokeSessionCommandHandler(
            IAuthUnitOfWork unitOfWork,
            ICurrentUserService currentUserService,
            ILogger<RevokeSessionCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _currentUserService = currentUserService;
            _logger = logger;
        }

        public async Task<Result> Handle(
            RevokeSessionCommand command,
            CancellationToken cancellationToken)
        {
            if (!_currentUserService.UserId.HasValue)
            {
                return Result.Failure(
                    Error.Unauthorized("NOT_AUTHENTICATED", "User not authenticated"));
            }

            var token = await _unitOfWork.RefreshTokens.GetByIdAsync(command.TokenId, cancellationToken);

            if (token == null)
            {
                return Result.Failure(
                    Error.NotFound("TOKEN_NOT_FOUND", "Session not found"));
            }

            if (token.UserId != _currentUserService.UserId.Value)
            {
                return Result.Failure(
                    Error.Forbidden("ACCESS_DENIED", "You can only revoke your own sessions"));
            }

            if (!token.IsActive)
            {
                return Result.Failure(
                    Error.Conflict("SESSION_INACTIVE", "Session is already inactive"));
            }

            var ipAddress = _currentUserService.IpAddress ?? "unknown";
            token.Revoke(ipAddress, "Revoked by user");

            _unitOfWork.RefreshTokens.Update(token);
            await _unitOfWork.SaveChangesAsync(cancellationToken);

            _logger.LogInformation(
                "Session revoked: TokenId={TokenId}, UserId={UserId}",
                token.Id,
                token.UserId);

            return Result.Success();
        }
    }
}

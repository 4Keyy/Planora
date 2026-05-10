using Planora.Auth.Application.Features.Authentication.Queries.ValidateToken;

namespace Planora.Auth.Application.Features.Authentication.Handlers.ValidateToken
{
    public sealed class ValidateTokenQueryHandler : IRequestHandler<ValidateTokenQuery, Result<TokenValidationDto>>
    {
        private readonly ITokenService _tokenService;
        private readonly IUserRepository _userRepository;
        private readonly ILogger<ValidateTokenQueryHandler> _logger;

        public ValidateTokenQueryHandler(
            ITokenService tokenService,
            IUserRepository userRepository,
            ILogger<ValidateTokenQueryHandler> logger)
        {
            _tokenService = tokenService;
            _userRepository = userRepository;
            _logger = logger;
        }

        public async Task<Result<TokenValidationDto>> Handle(
            ValidateTokenQuery query,
            CancellationToken cancellationToken)
        {
            try
            {
                var userId = _tokenService.ValidateAccessToken(query.Token);

                if (!userId.HasValue)
                {
                    _logger.LogWarning("Invalid token validation attempt");

                    return Result.Success(new TokenValidationDto
                    {
                        IsValid = false,
                        Message = "Token is invalid or expired"
                    });
                }

                var user = await _userRepository.GetByIdAsync(userId.Value, cancellationToken);

                if (user == null)
                {
                    _logger.LogWarning("Token valid but user not found: {UserId}", userId.Value);

                    return Result.Success(new TokenValidationDto
                    {
                        IsValid = false,
                        UserId = userId.Value,
                        Message = "User not found"
                    });
                }

                if (user.IsLocked())
                {
                    _logger.LogWarning("Token valid but user is locked: {UserId}", userId.Value);

                    return Result.Success(new TokenValidationDto
                    {
                        IsValid = false,
                        UserId = userId.Value,
                        Email = user.Email.Value,
                        Message = "User account is locked"
                    });
                }

                var tokenLifetime = _tokenService.GetAccessTokenLifetime();
                var expiresAt = DateTime.UtcNow.Add(tokenLifetime);

                return Result.Success(new TokenValidationDto
                {
                    IsValid = true,
                    UserId = user.Id,
                    Email = user.Email.Value,
                    ExpiresAt = expiresAt,
                    Message = "Token is valid"
                });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error validating token");
                return Result.Failure<TokenValidationDto>(
                    Error.InternalServer("TOKEN_VALIDATION_ERROR", "An error occurred while validating token"));
            }
        }
    }
}

using Planora.Auth.Application.Features.Authentication.Commands.Register;
using Planora.Auth.Application.Features.Authentication.Response.Register;
using Planora.Auth.Application.Common.Options;
using Planora.Auth.Application.Common.Security;
using Planora.BuildingBlocks.Application.Services;
using Planora.BuildingBlocks.Infrastructure.Services;
using Planora.BuildingBlocks.Domain.Exceptions;
using Microsoft.Extensions.Options;
using static Planora.BuildingBlocks.Application.Services.BusinessEvents;

namespace Planora.Auth.Application.Features.Authentication.Handlers.Register
{
    public sealed class RegisterCommandHandler : IRequestHandler<RegisterCommand, BuildingBlocks.Domain.Result<RegisterResponse>>
    {
        private static readonly TimeSpan EmailVerificationTokenLifetime = TimeSpan.FromHours(24);

        private readonly IAuthUnitOfWork _unitOfWork;
        private readonly IPasswordHasher _passwordHasher;
        private readonly ITokenService _tokenService;
        private readonly ICurrentUserService _currentUserService;
        private readonly IEmailService _emailService;
        private readonly IOptions<FrontendOptions> _frontendOptions;
        private readonly IBusinessEventLogger _businessLogger;
        private readonly ILogger<RegisterCommandHandler> _logger;

        public RegisterCommandHandler(
            IAuthUnitOfWork unitOfWork,
            IPasswordHasher passwordHasher,
            ITokenService tokenService,
            ICurrentUserService currentUserService,
            IEmailService emailService,
            IOptions<FrontendOptions> frontendOptions,
            IBusinessEventLogger businessLogger,
            ILogger<RegisterCommandHandler> logger)
        {
            _unitOfWork = unitOfWork;
            _passwordHasher = passwordHasher;
            _tokenService = tokenService;
            _currentUserService = currentUserService;
            _emailService = emailService;
            _frontendOptions = frontendOptions;
            _businessLogger = businessLogger;
            _logger = logger;
        }

        public async Task<BuildingBlocks.Domain.Result<RegisterResponse>> Handle(
            RegisterCommand command,
            CancellationToken cancellationToken)
        {
            _logger.LogInformation("Starting registration for email: {Email}", command.Email);

            Email email = Email.Create(command.Email);
            _logger.LogInformation("Email value object created: {Email}", email.Value);

            var existingUser = await _unitOfWork.Users.GetByEmailAsync(email, cancellationToken);
            if (existingUser != null)
            {
                _logger.LogWarning("Registration attempt with existing email: {Email}", email.Value);
                throw new DuplicateEntityException("User", "email", email.Value);
            }

            _logger.LogInformation("Email is unique, proceeding with user creation");

            var passwordHash = _passwordHasher.HashPassword(command.Password);
            _logger.LogInformation("Password hashed successfully");

            var user = User.Create(
                email,
                passwordHash,
                command.FirstName.Trim(),
                command.LastName.Trim());
            
            _logger.LogInformation("User entity created with ID: {UserId}", user.Id);

            var emailVerificationToken = OpaqueToken.Generate();
            user.SetEmailVerificationToken(
                OpaqueToken.Hash(emailVerificationToken),
                DateTime.UtcNow.Add(EmailVerificationTokenLifetime));

            var accessToken = _tokenService.GenerateAccessToken(user);
            _logger.LogInformation("Access token generated");

            var refreshTokenValue = _tokenService.GenerateRefreshToken();
            var refreshTokenExpiry = DateTime.UtcNow.Add(_tokenService.GetRefreshTokenLifetime());
            _logger.LogInformation("Refresh token generated, expires at: {ExpiresAt}", refreshTokenExpiry);

            var refreshToken = user.AddRefreshToken(
                refreshTokenValue,
                _currentUserService.IpAddress ?? "unknown",
                refreshTokenExpiry);
            
            _logger.LogInformation("Refresh token added to user");

            // user.MarkAsModified(user.Id); // Removed to avoid unnecessary updates on new entities
            _logger.LogInformation("User marked as modified");

            try
            {
                await _unitOfWork.Users.AddAsync(user, cancellationToken);
                _logger.LogInformation("User added to repository");

                await _unitOfWork.SaveChangesAsync(cancellationToken);
                _logger.LogInformation("Changes saved successfully");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error during SaveChangesAsync: {Message}. Inner: {InnerMessage}", 
                    ex.Message, ex.InnerException?.Message);
                throw;
            }

            var response = new RegisterResponse
            {
                UserId = user.Id,
                Email = user.Email.Value,
                FirstName = user.FirstName,
                LastName = user.LastName,
                AccessToken = accessToken,
                RefreshToken = refreshToken.Token,
                ExpiresAt = refreshTokenExpiry
            };

            _logger.LogInformation("Registration successful for user: {UserId}", user.Id);

            try
            {
                var verificationLink = FrontendLinkBuilder.EmailVerification(
                    _frontendOptions.Value,
                    emailVerificationToken);

                await _emailService.SendEmailVerificationAsync(
                    user.Email.Value,
                    user.FirstName,
                    verificationLink,
                    cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to send verification email for user: {UserId}", user.Id);
            }

            // Log business event
            _businessLogger.LogBusinessEvent(
                BusinessEvents.UserRegistered,
                $"User {user.Id} registered with email {user.Email.Value}",
                new { UserId = user.Id, Email = user.Email.Value },
                user.Id.ToString());
            _businessLogger.LogBusinessEvent(
                SignupCompleted,
                $"User {user.Id} completed signup",
                new { UserId = user.Id, Email = user.Email.Value },
                user.Id.ToString());

            return BuildingBlocks.Domain.Result<RegisterResponse>.Success(response);
        }
    }
}

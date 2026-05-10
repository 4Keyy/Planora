using AutoMapper;
using Planora.Auth.Application.Common.DTOs;
using Planora.Auth.Application.Common.Mappings;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.ValueObjects;
using Planora.Auth.Infrastructure.Auditing;
using Planora.Auth.Infrastructure.Services.Authentication;
using Planora.Auth.Infrastructure.Services.Common;
using Planora.Auth.Infrastructure.Services.Messaging;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using OtpNet;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure;

public sealed class AuthSupportServicesTests
{
    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public async Task EmailService_ShouldLogAllSupportedNotifications()
    {
        var logger = new Mock<ILogger<EmailService>>();
        var service = new EmailService(logger.Object);

        await service.SendEmailVerificationAsync("user@example.com", "Ada", "https://verify", CancellationToken.None);
        await service.SendPasswordChangedNotificationAsync("user@example.com", "Ada", CancellationToken.None);
        await service.SendEmailChangedNotificationAsync("old@example.com", "new@example.com", "Ada", CancellationToken.None);
        await service.SendPasswordResetEmailAsync("user@example.com", "Ada", "https://reset", CancellationToken.None);
        await service.SendAccountLockedNotificationAsync("user@example.com", "Ada", DateTime.UtcNow.AddMinutes(15), CancellationToken.None);
        await service.SendTwoFactorEnabledNotificationAsync("user@example.com", "Ada", CancellationToken.None);

        logger.Verify(
            x => x.Log(
                LogLevel.Information,
                It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((_, _) => true),
                null,
            It.IsAny<Func<It.IsAnyType, Exception?, string>>()),
            Times.Exactly(6));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public async Task EmailService_ShouldSendVerificationThroughConfiguredGmailSmtpProvider()
    {
        var logger = new Mock<ILogger<EmailService>>();
        var sender = new CapturingEmailMessageSender();
        var service = new EmailService(
            logger.Object,
            Options.Create(new EmailOptions
            {
                Provider = EmailOptions.GmailSmtpProvider,
                Username = "sender@gmail.com",
                Password = "app-password",
                FromName = "Planora"
            }),
            sender);

        await service.SendEmailVerificationAsync(
            "user@example.com",
            "Ada",
            "https://planora.test/auth/verify-email?token=abc",
            CancellationToken.None);

        var message = Assert.Single(sender.Messages);
        Assert.Equal("user@example.com", message.ToEmail);
        Assert.Equal("Ada", message.ToName);
        Assert.Equal("Verify your Planora email", message.Subject);
        Assert.Contains("https://planora.test/auth/verify-email?token=abc", message.HtmlBody);
        Assert.Contains("Verify email", message.TextBody);
        Assert.Equal("smtp.gmail.com", sender.Options!.SmtpHost);
        Assert.Equal(587, sender.Options.SmtpPort);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public async Task EmailService_ShouldRequireCredentialsWhenSmtpProviderIsEnabled()
    {
        var logger = new Mock<ILogger<EmailService>>();
        var service = new EmailService(
            logger.Object,
            Options.Create(new EmailOptions { Provider = EmailOptions.GmailSmtpProvider }),
            new CapturingEmailMessageSender());

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SendEmailVerificationAsync(
                "user@example.com",
                "Ada",
                "https://verify",
                CancellationToken.None));

        Assert.Contains("Email:Username", ex.Message);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public async Task EmailService_ShouldRejectUnknownProvider()
    {
        var logger = new Mock<ILogger<EmailService>>();
        var service = new EmailService(
            logger.Object,
            Options.Create(new EmailOptions { Provider = "Gmail" }),
            new CapturingEmailMessageSender());

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.SendEmailVerificationAsync(
                "user@example.com",
                "Ada",
                "https://verify",
                CancellationToken.None));

        Assert.Contains("Email:Provider", ex.Message);
    }

    [Theory]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    [InlineData("1", 5)]
    [InlineData("30", 30)]
    [InlineData("120", 60)]
    [InlineData(null, 15)]
    public void PasswordResetTokenService_ShouldClampLifetimeAndValidateFixedTimeHash(string? configuredMinutes, int expectedMinutes)
    {
        var service = new PasswordResetTokenService(CreateConfiguration(configuredMinutes));
        var token = service.GenerateToken();
        var tokenHash = service.HashToken(token);

        Assert.Equal(TimeSpan.FromMinutes(expectedMinutes), service.TokenLifetime);
        Assert.NotEmpty(token);
        Assert.NotEqual(token, tokenHash);
        Assert.True(service.IsTokenValid(token, tokenHash, DateTime.UtcNow.AddMinutes(10)));
        Assert.False(service.IsTokenValid("wrong-token", tokenHash, DateTime.UtcNow.AddMinutes(10)));
        Assert.False(service.IsTokenValid(token, tokenHash[..^1], DateTime.UtcNow.AddMinutes(10)));
        Assert.False(service.IsTokenValid(token, tokenHash, DateTime.UtcNow.AddSeconds(-1)));
        Assert.False(service.IsTokenValid(token, null, DateTime.UtcNow.AddMinutes(10)));
        Assert.False(service.IsTokenValid(string.Empty, tokenHash, DateTime.UtcNow.AddMinutes(10)));
        Assert.Equal(string.Empty, service.HashToken(" "));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void TwoFactorService_ShouldGenerateSecretQrCodeAndValidateCurrentTotpOnly()
    {
        var service = new TwoFactorService();

        var secret = service.GenerateSecret();
        var currentCode = new Totp(Base32Encoding.ToBytes(secret)).ComputeTotp(DateTime.UtcNow);
        var wrongCode = currentCode == "000000" ? "111111" : "000000";
        var qrCode = service.GenerateQrCodeUrl("user@example.com", secret);

        Assert.NotEmpty(secret);
        Assert.True(secret.All(character => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567=".Contains(character)));
        Assert.NotEmpty(qrCode);
        Assert.True(service.VerifyCode(secret, currentCode));
        Assert.False(service.VerifyCode(secret, wrongCode));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void AuditLog_ShouldRepresentEntityAndEventAuditRecords()
    {
        var entityId = Guid.NewGuid();
        var entityLog = new AuditLog("Updated", "User", entityId, "{\"FirstName\":\"Old\"}", "{\"FirstName\":\"New\"}");
        var eventLog = AuditLog.CreateEventLog("PasswordChanged", "Password was changed", entityId, "127.0.0.1", "High");

        Assert.Equal("Updated", entityLog.Action);
        Assert.Equal("User", entityLog.EntityName);
        Assert.Equal(entityId, entityLog.EntityId);
        Assert.Equal("{\"FirstName\":\"Old\"}", entityLog.OldValues);
        Assert.Equal("{\"FirstName\":\"New\"}", entityLog.NewValues);

        Assert.Equal("PasswordChanged", eventLog.Action);
        Assert.Equal("Password was changed", eventLog.Details);
        Assert.Equal("User", eventLog.EntityName);
        Assert.Equal(entityId, eventLog.EntityId);
        Assert.Equal("127.0.0.1", eventLog.IpAddress);
        Assert.Equal("High", eventLog.Severity);
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Regression")]
    public void CommonDomainAndDtoHelpers_ShouldExposeExpectedDefaultsAndComputedValues()
    {
        var before = DateTime.UtcNow;
        var now = new DateTimeService().UtcNow;
        var after = DateTime.UtcNow;
        var role = Role.Create("Admin", "System administrators");
        var userDetail = new UserDetailDto
        {
            FirstName = "Ada",
            LastName = "Lovelace"
        };

        Assert.InRange(now, before, after);
        Assert.Equal("Admin", role.Name);
        Assert.Equal("System administrators", role.Description);
        Assert.Empty(role.UserRoles);
        Assert.Throws<ArgumentException>(() => Role.Create(" "));
        Assert.Equal("Ada Lovelace", userDetail.FullName);
    }

    [Fact]
    [Trait("TestType", "Module")]
    [Trait("TestType", "Regression")]
    public void MappingProfile_ShouldMapAuthDomainObjectsToDtos()
    {
        var configuration = new MapperConfiguration(
            cfg => cfg.AddProfile<MappingProfile>(),
            NullLoggerFactory.Instance);
        configuration.AssertConfigurationIsValid();
        var mapper = configuration.CreateMapper();
        var user = User.Create(Email.Create("mapper@example.com"), "hash", "Map", "User");
        user.VerifyEmail();
        user.AddRefreshToken("refresh-token", "127.0.0.1", DateTime.UtcNow.AddDays(7));
        var refreshToken = user.RefreshTokens.Single();
        var loginHistory = new LoginHistory(user.Id, "127.0.0.1", "Chrome", true);

        var userDto = mapper.Map<UserDto>(user);
        var userDetail = mapper.Map<UserDetailDto>(user);
        var userList = mapper.Map<UserListDto>(user);
        var refreshDto = mapper.Map<RefreshTokenDto>(refreshToken);
        var refreshDetail = mapper.Map<RefreshTokenDetailDto>(refreshToken);
        var loginDto = mapper.Map<LoginHistoryDto>(loginHistory);
        var loginPaged = mapper.Map<LoginHistoryPagedDto>(loginHistory);
        var session = mapper.Map<SessionDto>(refreshToken);

        Assert.Equal("mapper@example.com", userDto.Email);
        Assert.Equal("Active", userDto.Status);
        Assert.True(userDto.IsEmailVerified);
        Assert.Empty(userDetail.RecentLogins);
        Assert.True(userDetail.IsEmailVerified);
        Assert.Equal("Map User", userList.FullName);
        Assert.Equal("refresh-token", refreshDto.Token);
        Assert.True(refreshDto.IsActive);
        Assert.False(refreshDetail.IsRevoked);
        Assert.Equal("Chrome", loginDto.UserAgent);
        Assert.Equal(string.Empty, loginPaged.Browser);
        Assert.Equal(refreshToken.CreatedAt, session.LastActivityAt);
        Assert.Equal(string.Empty, session.DeviceName);
    }

    private static IConfiguration CreateConfiguration(string? configuredMinutes)
    {
        var values = configuredMinutes is null
            ? new Dictionary<string, string?>()
            : new Dictionary<string, string?> { ["PasswordReset:TokenLifetimeMinutes"] = configuredMinutes };

        return new ConfigurationBuilder()
            .AddInMemoryCollection(values)
            .Build();
    }

    private sealed class CapturingEmailMessageSender : IEmailMessageSender
    {
        public List<EmailMessage> Messages { get; } = new();

        public EmailOptions? Options { get; private set; }

        public Task SendAsync(
            EmailMessage message,
            EmailOptions options,
            CancellationToken cancellationToken)
        {
            Messages.Add(message);
            Options = options;
            return Task.CompletedTask;
        }
    }
}

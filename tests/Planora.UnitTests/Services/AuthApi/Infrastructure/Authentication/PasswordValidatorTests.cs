using System.Net;
using System.Security.Cryptography;
using System.Text;
using Planora.Auth.Application.Common.Interfaces;
using Planora.Auth.Domain.Entities;
using Planora.Auth.Domain.Repositories;
using Planora.Auth.Infrastructure.Services.Authentication;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;

namespace Planora.UnitTests.Services.AuthApi.Infrastructure.Authentication;

public class PasswordValidatorTests
{
    [Theory]
    [InlineData("", false)]
    [InlineData("Short1!", false)]
    [InlineData("lowercase1!", false)]
    [InlineData("UPPERCASE1!", false)]
    [InlineData("NoDigits!", false)]
    [InlineData("NoSpecial123", false)]
    [InlineData("Password123!", false)]
    [InlineData("Abcd1234!", false)]
    [InlineData("Aaaa1234!", false)]
    [InlineData("aaaaB9!x", false)]
    [InlineData("Valid-Password-927", true)]
    public void IsStrongPassword_ShouldApplyConfiguredPasswordPolicy(string password, bool expected)
    {
        var validator = CreateValidator();

        Assert.Equal(expected, validator.IsStrongPassword(password));
    }

    [Fact]
    public void IsStrongPassword_ShouldRespectRelaxedPolicyAndMaxLength()
    {
        var validator = CreateValidator(new Dictionary<string, string?>
        {
            ["Password:RequiredLength"] = "3",
            ["Password:MaxLength"] = "6",
            ["Password:RequireUppercase"] = "false",
            ["Password:RequireLowercase"] = "false",
            ["Password:RequireDigit"] = "false",
            ["Password:RequireSpecialCharacter"] = "false"
        });

        Assert.True(validator.IsStrongPassword("aB9!x"));
        Assert.False(validator.IsStrongPassword("aB9!xyz"));
    }

    [Theory]
    [InlineData("", 0)]
    [InlineData("weak", 4)]
    [InlineData("Strong-Password-927x", 10)]
    public void CalculatePasswordStrength_ShouldScoreImportantSecuritySignals(string password, int expected)
    {
        var validator = CreateValidator();

        Assert.Equal(expected, validator.CalculatePasswordStrength(password));
    }

    [Fact]
    public async Task IsPasswordCompromisedAsync_ShouldSkipNetwork_WhenDisabled()
    {
        var handler = new CountingHttpHandler(HttpStatusCode.OK, "anything");
        var validator = CreateValidator(new Dictionary<string, string?>
        {
            ["Password:CheckCompromised"] = "false"
        }, handler: handler);

        var compromised = await validator.IsPasswordCompromisedAsync("password");

        Assert.False(compromised);
        Assert.Equal(0, handler.CallCount);
    }

    [Fact]
    public async Task IsPasswordCompromisedAsync_ShouldMatchPwnedSuffixFromApiResponse()
    {
        const string password = "CompromisedPassword123!";
        var (_, suffix) = CreateSha1Parts(password);
        var handler = new CountingHttpHandler(HttpStatusCode.OK, $"{suffix}:42\nABCDEF:1");
        var validator = CreateValidator(handler: handler);

        var compromised = await validator.IsPasswordCompromisedAsync(password);

        Assert.True(compromised);
        Assert.Equal(1, handler.CallCount);
    }

    [Fact]
    public async Task IsPasswordCompromisedAsync_ShouldFailOpenOnApiErrorsAndExceptions()
    {
        var failedApi = CreateValidator(handler: new CountingHttpHandler(HttpStatusCode.TooManyRequests, ""));
        Assert.False(await failedApi.IsPasswordCompromisedAsync("Password123!"));

        var throwingApi = CreateValidator(handler: new ThrowingHttpHandler());
        Assert.False(await throwingApi.IsPasswordCompromisedAsync("Password123!"));
    }

    [Fact]
    public async Task IsDifferentFromPreviousPasswordsAsync_ShouldRejectReusedPassword()
    {
        var userId = Guid.NewGuid();
        var history = new PasswordHistory(userId, "old-hash");
        var passwordHistory = new Mock<IPasswordHistoryRepository>();
        var hasher = new Mock<IPasswordHasher>();
        passwordHistory
            .Setup(x => x.GetByUserIdAsync(userId, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { history });
        hasher.Setup(x => x.VerifyPassword("NewPassword123!", "old-hash")).Returns(true);
        var validator = CreateValidator(passwordHistory: passwordHistory, hasher: hasher);

        var different = await validator.IsDifferentFromPreviousPasswordsAsync(userId, "NewPassword123!");

        Assert.False(different);
    }

    [Fact]
    public async Task IsDifferentFromPreviousPasswordsAsync_ShouldReturnTrueForNewPassword_AndFailOpenOnRepositoryError()
    {
        var userId = Guid.NewGuid();
        var history = new PasswordHistory(userId, "old-hash");
        var passwordHistory = new Mock<IPasswordHistoryRepository>();
        var hasher = new Mock<IPasswordHasher>();
        passwordHistory
            .Setup(x => x.GetByUserIdAsync(userId, 5, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new[] { history });
        hasher.Setup(x => x.VerifyPassword("NewPassword123!", "old-hash")).Returns(false);
        var validator = CreateValidator(passwordHistory: passwordHistory, hasher: hasher);
        Assert.True(await validator.IsDifferentFromPreviousPasswordsAsync(userId, "NewPassword123!"));

        passwordHistory
            .Setup(x => x.GetByUserIdAsync(userId, 5, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new InvalidOperationException("database offline"));
        Assert.True(await validator.IsDifferentFromPreviousPasswordsAsync(userId, "NewPassword123!"));
    }

    // ---- Boundary tests for IsStrongPassword (added to kill equality mutants
    // identified by Stryker on the length and pattern-detection branches). ----

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void IsStrongPassword_AtMinimumLength_Passes()
    {
        // Exactly 8 chars; all classes present; no 4-char sequence or repetition.
        Assert.True(CreateValidator().IsStrongPassword("Ay9!Z3xK"));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void IsStrongPassword_OneShortOfMinimumLength_Fails()
    {
        Assert.False(CreateValidator().IsStrongPassword("Ay9!Z3x")); // 7 chars
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void IsStrongPassword_AtMaximumLength_Passes()
    {
        // 128 chars = prefix (8) + 15 × 8-char alternating block. The block has
        // no 4-char ASCII-sequence and no 4-char repetition, so doing it 15
        // times in a row still passes both pattern checks.
        var password = "Ay9!Z3xK" + string.Concat(Enumerable.Repeat("PqRs8tUv", 15));
        Assert.Equal(128, password.Length);
        Assert.True(CreateValidator().IsStrongPassword(password));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void IsStrongPassword_OneOverMaximumLength_Fails()
    {
        var password = "Ay9!Z3xK" + string.Concat(Enumerable.Repeat("PqRs8tUv", 15)) + "a";
        Assert.Equal(129, password.Length);
        Assert.False(CreateValidator().IsStrongPassword(password));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void IsStrongPassword_SequentialAtEnd_Fails()
    {
        // The 4-char ASCII sequence starts at the LAST possible index, hitting
        // the i == password.Length - length boundary of HasSequentialCharacters.
        Assert.False(CreateValidator().IsStrongPassword("A1!_Eabcd")); // 9 chars
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void IsStrongPassword_RepeatingAtEnd_Fails()
    {
        // The 4-char repetition starts at the LAST possible index, hitting the
        // i == password.Length - length boundary of HasRepeatingCharacters.
        Assert.False(CreateValidator().IsStrongPassword("A1!_Bxxxx")); // 9 chars
    }

    // ---- Boundary tests for CalculatePasswordStrength length tiers. ----

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void CalculatePasswordStrength_AtEightCharBoundary_AwardsLowestLengthBoost()
    {
        // Score = 1 (length ≥ 8) + 4 (classes) + 1 (uniqueness) + 1 (no seq-3) + 1 (no rep-3) = 8.
        Assert.Equal(8, CreateValidator().CalculatePasswordStrength("Ay9!Z3xK"));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void CalculatePasswordStrength_AtTwelveCharBoundary_AwardsSecondLengthBoost()
    {
        // Score = 1 + 1 (length ≥ 8 and ≥ 12) + 4 + 1 + 1 + 1 = 9.
        Assert.Equal(9, CreateValidator().CalculatePasswordStrength("Ay9!Z3xK7M2#"));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void CalculatePasswordStrength_AtSixteenCharBoundary_AwardsThirdLengthBoost()
    {
        // All three length tiers credited; capped at 10.
        Assert.Equal(10, CreateValidator().CalculatePasswordStrength("Ay9!Z3xK7M2#vN5*"));
    }

    [Fact]
    [Trait("TestType", "Unit")]
    [Trait("TestType", "Boundary")]
    public void CalculatePasswordStrength_AtUniqueCharThreshold_AwardsDiversityBoost()
    {
        // Length 10 → threshold = 7.0. The password has exactly 7 distinct chars
        // (A, b, 1, !, c, D, 2 — covering all four classes), so uniqueChars is
        // exactly equal to length * 0.7. This pins down the `>=` boundary in
        // CalculatePasswordStrength so an `>` mutation drops the score.
        // Expected score: 1 (len ≥ 8) + 4 (classes) + 1 (unique ≥ 70%)
        // + 1 (no seq-3) + 1 (no rep-3) = 8.
        Assert.Equal(8, CreateValidator().CalculatePasswordStrength("Ab1!cD2Abc"));
    }

    private static PasswordValidator CreateValidator(
        IDictionary<string, string?>? settings = null,
        HttpMessageHandler? handler = null,
        Mock<IPasswordHistoryRepository>? passwordHistory = null,
        Mock<IPasswordHasher>? hasher = null)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(settings ?? new Dictionary<string, string?>())
            .Build();
        var httpClientFactory = new Mock<IHttpClientFactory>();
        httpClientFactory
            .Setup(x => x.CreateClient(It.IsAny<string>()))
            .Returns(new HttpClient(handler ?? new CountingHttpHandler(HttpStatusCode.OK, "")));

        return new PasswordValidator(
            Mock.Of<ILogger<PasswordValidator>>(),
            passwordHistory?.Object ?? Mock.Of<IPasswordHistoryRepository>(),
            hasher?.Object ?? Mock.Of<IPasswordHasher>(),
            httpClientFactory.Object,
            configuration);
    }

    private static (string Prefix, string Suffix) CreateSha1Parts(string password)
    {
        var hashBytes = SHA1.HashData(Encoding.UTF8.GetBytes(password));
        var hash = BitConverter.ToString(hashBytes).Replace("-", "").ToUpperInvariant();
        return (hash[..5], hash[5..]);
    }

    private sealed class CountingHttpHandler(HttpStatusCode statusCode, string content) : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(new HttpResponseMessage(statusCode)
            {
                Content = new StringContent(content)
            });
        }
    }

    private sealed class ThrowingHttpHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
            => throw new HttpRequestException("network failure");
    }
}

using Planora.Auth.Application.Common.Security;

namespace Planora.UnitTests.Services.AuthApi.Common.Security;

public class OpaqueTokenTests
{
    [Fact]
    public void Generate_ShouldReturnUrlSafeHighEntropyTokenWithoutPadding()
    {
        var tokens = Enumerable.Range(0, 128)
            .Select(_ => OpaqueToken.Generate())
            .ToArray();

        Assert.All(tokens, token =>
        {
            Assert.Equal(43, token.Length);
            Assert.DoesNotContain("+", token);
            Assert.DoesNotContain("/", token);
            Assert.DoesNotContain("=", token);
        });
        Assert.Equal(tokens.Length, tokens.Distinct(StringComparer.Ordinal).Count());
    }

    [Fact]
    public void Hash_ShouldBeDeterministicTrimmedSha256Hex_AndNeverExposeRawToken()
    {
        const string token = "opaque-reset-token";

        var hash = OpaqueToken.Hash(token);
        var hashWithWhitespace = OpaqueToken.Hash($"  {token}\r\n");

        Assert.Equal(hash, hashWithWhitespace);
        Assert.Equal(64, hash.Length);
        Assert.Matches("^[0-9A-F]{64}$", hash);
        Assert.DoesNotContain(token, hash, StringComparison.Ordinal);
    }
}

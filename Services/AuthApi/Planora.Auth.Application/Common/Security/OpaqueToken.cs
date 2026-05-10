using System.Security.Cryptography;
using System.Text;

namespace Planora.Auth.Application.Common.Security;

public static class OpaqueToken
{
    private const int TokenByteLength = 32;

    public static string Generate()
    {
        var bytes = RandomNumberGenerator.GetBytes(TokenByteLength);
        return Convert.ToBase64String(bytes)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    public static string Hash(string token)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(token.Trim()));
        return Convert.ToHexString(hash);
    }
}

using System.Security.Cryptography;
using System.Text;

namespace Planora.Auth.Domain.Security
{
    /// <summary>
    /// One-way hash for refresh tokens at rest. The raw token is the bearer secret handed to the
    /// client; only its SHA-256 hash is ever persisted, so read access to the database (a backup,
    /// a replica, SQLi in a neighbouring table) yields no usable sessions. Mirrors the algorithm
    /// used for reset/verification tokens (Application <c>OpaqueToken.Hash</c>): SHA-256 over the
    /// trimmed UTF-8 bytes, hex-encoded — deterministic, so a presented raw token can be looked up
    /// by hashing it and comparing.
    /// </summary>
    public static class RefreshTokenHash
    {
        public static string Of(string rawToken)
        {
            var hash = SHA256.HashData(Encoding.UTF8.GetBytes(rawToken.Trim()));
            return Convert.ToHexString(hash);
        }
    }
}

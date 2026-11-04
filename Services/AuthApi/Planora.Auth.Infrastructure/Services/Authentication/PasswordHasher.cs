using System.Globalization;

namespace Planora.Auth.Infrastructure.Services.Authentication;

/// <summary>
/// PBKDF2 (HMAC-SHA512) password hasher with a self-describing, versioned on-disk format.
/// </summary>
/// <remarks>
/// New hashes are stored as <c>$pbkdf2-sha512$v=1$i=&lt;iterations&gt;$&lt;base64 salt&gt;$&lt;base64 key&gt;</c>.
/// Embedding the algorithm version and iteration count lets the work factor be raised over time
/// without breaking previously stored hashes: <see cref="VerifyPassword"/> reads the parameters
/// from the hash itself, and <see cref="NeedsRehash"/> flags any hash whose parameters differ from
/// the current policy so it can be transparently upgraded on the next successful login.
///
/// Hashes written before the versioned format (raw <c>base64(salt(16) || key(32))</c>, 100,000
/// iterations) are still recognised and verified, and are reported by <see cref="NeedsRehash"/> as
/// needing an upgrade.
/// </remarks>
public sealed class PasswordHasher : IPasswordHasher
{
    private const int SaltSize = 16;
    private const int HashSize = 32;

    // Current policy. Raise CurrentIterations to harden; old hashes keep verifying and are
    // flagged for rehash. OWASP's 2023 PBKDF2-HMAC-SHA512 floor is 210,000 iterations.
    private const string VersionMarker = "v=1";
    private const int CurrentIterations = 210_000;
    private const int MaxSupportedIterations = 1_000_000;

    // Iteration count used by the pre-versioning format, kept solely for verifying legacy hashes.
    private const int LegacyIterations = 100_000;

    private const string Prefix = "$pbkdf2-sha512$";

    private static readonly HashAlgorithmName Algorithm = HashAlgorithmName.SHA512;

    public string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, CurrentIterations, Algorithm, HashSize);

        return string.Create(CultureInfo.InvariantCulture,
            $"{Prefix}{VersionMarker}$i={CurrentIterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}");
    }

    public bool VerifyPassword(string password, string passwordHash)
    {
        if (passwordHash.StartsWith(Prefix, StringComparison.Ordinal))
        {
            Span<byte> salt = stackalloc byte[SaltSize];
            Span<byte> expected = stackalloc byte[HashSize];
            if (!TryParseVersioned(passwordHash, salt, expected, out var iterations))
                return false;

            Span<byte> actual = stackalloc byte[HashSize];
            Rfc2898DeriveBytes.Pbkdf2(password, salt, actual, iterations, Algorithm);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }

        return VerifyLegacy(password, passwordHash);
    }

    public bool NeedsRehash(string passwordHash)
    {
        // Legacy (unversioned) hashes always need upgrading to the versioned format.
        if (!passwordHash.StartsWith(Prefix, StringComparison.Ordinal))
            return true;

        Span<byte> salt = stackalloc byte[SaltSize];
        Span<byte> hash = stackalloc byte[HashSize];
        return !TryParseVersioned(passwordHash, salt, hash, out var iterations) || iterations != CurrentIterations;
    }

    // --- legacy format: base64(salt(16) || key(32)), 100k iterations, SHA-512 ---
    private static bool VerifyLegacy(string password, string passwordHash)
    {
        Span<byte> hashBytes = stackalloc byte[SaltSize + HashSize];
        if (!DecodeExactSize(passwordHash, hashBytes))
            return false;

        Span<byte> actual = stackalloc byte[HashSize];
        Rfc2898DeriveBytes.Pbkdf2(password, hashBytes[..SaltSize], actual, LegacyIterations, Algorithm);
        return CryptographicOperations.FixedTimeEquals(actual, hashBytes[SaltSize..]);
    }

    private static bool TryParseVersioned(string passwordHash, Span<byte> salt, Span<byte> hash, out int iterations)
    {
        iterations = 0;
        var parts = passwordHash.Split('$', 7);
        return parts.Length == 6 &&
            parts[2] == VersionMarker &&
            parts[3].StartsWith("i=", StringComparison.Ordinal) &&
            int.TryParse(parts[3].AsSpan(2), NumberStyles.None, CultureInfo.InvariantCulture, out iterations) &&
            iterations is > 0 and <= MaxSupportedIterations &&
            DecodeExactSize(parts[4], salt) &&
            DecodeExactSize(parts[5], hash);
    }

    private static bool DecodeExactSize(string value, Span<byte> decoded) =>
        Convert.TryFromBase64String(value, decoded, out var written) && written == decoded.Length;
}

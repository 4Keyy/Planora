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
    private const int CurrentVersion = 1;
    private const int CurrentIterations = 210_000;

    // Iteration count used by the pre-versioning format, kept solely for verifying legacy hashes.
    private const int LegacyIterations = 100_000;

    private const string Prefix = "$pbkdf2-sha512$";

    private static readonly HashAlgorithmName Algorithm = HashAlgorithmName.SHA512;

    public string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltSize);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, CurrentIterations, Algorithm, HashSize);

        return string.Create(CultureInfo.InvariantCulture,
            $"{Prefix}v={CurrentVersion}$i={CurrentIterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}");
    }

    public bool VerifyPassword(string password, string passwordHash)
    {
        if (passwordHash.StartsWith(Prefix, StringComparison.Ordinal))
        {
            var (iterations, salt, expected) = ParseVersioned(passwordHash);
            var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, iterations, Algorithm, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }

        return VerifyLegacy(password, passwordHash);
    }

    public bool NeedsRehash(string passwordHash)
    {
        // Legacy (unversioned) hashes always need upgrading to the versioned format.
        if (!passwordHash.StartsWith(Prefix, StringComparison.Ordinal))
            return true;

        var (version, iterations) = ParseParameters(passwordHash);
        return version != CurrentVersion || iterations != CurrentIterations;
    }

    // --- legacy format: base64(salt(16) || key(32)), 100k iterations, SHA-512 ---
    private static bool VerifyLegacy(string password, string passwordHash)
    {
        var hashBytes = Convert.FromBase64String(passwordHash);

        var salt = new byte[SaltSize];
        Array.Copy(hashBytes, 0, salt, 0, SaltSize);

        var actual = Rfc2898DeriveBytes.Pbkdf2(password, salt, LegacyIterations, Algorithm, HashSize);
        return CryptographicOperations.FixedTimeEquals(actual, hashBytes.AsSpan(SaltSize, HashSize));
    }

    private static (int Iterations, byte[] Salt, byte[] Hash) ParseVersioned(string passwordHash)
    {
        // $pbkdf2-sha512$v=1$i=210000$<salt>$<hash>
        var parts = passwordHash.Split('$');
        if (parts.Length != 6)
            throw new FormatException("Malformed PBKDF2 hash: unexpected segment count.");

        var iterations = int.Parse(parts[3].AsSpan("i=".Length), CultureInfo.InvariantCulture);
        var salt = Convert.FromBase64String(parts[4]);
        var hash = Convert.FromBase64String(parts[5]);
        return (iterations, salt, hash);
    }

    private static (int Version, int Iterations) ParseParameters(string passwordHash)
    {
        var parts = passwordHash.Split('$');
        if (parts.Length != 6)
            throw new FormatException("Malformed PBKDF2 hash: unexpected segment count.");

        var version = int.Parse(parts[2].AsSpan("v=".Length), CultureInfo.InvariantCulture);
        var iterations = int.Parse(parts[3].AsSpan("i=".Length), CultureInfo.InvariantCulture);
        return (version, iterations);
    }
}

namespace Planora.Auth.Infrastructure.Services.Authentication
{
    public sealed class PasswordHasher : IPasswordHasher
    {
        private const int SaltSize = 16;
        private const int HashSize = 32;
        private const int Iterations = 100000;

        public string HashPassword(string password)
        {
            // Rfc2898DeriveBytes.Pbkdf2 (static) replaces the obsolete instance API
            // (SYSLIB0060) and produces byte-identical output for the same salt,
            // iteration count, SHA-512 and UTF-8 password encoding — so hashes stay
            // compatible across the .NET 9 -> 10 migration.
            var salt = RandomNumberGenerator.GetBytes(SaltSize);
            var hash = Rfc2898DeriveBytes.Pbkdf2(
                password,
                salt,
                Iterations,
                HashAlgorithmName.SHA512,
                HashSize);

            var hashBytes = new byte[SaltSize + HashSize];
            Array.Copy(salt, 0, hashBytes, 0, SaltSize);
            Array.Copy(hash, 0, hashBytes, SaltSize, HashSize);

            return Convert.ToBase64String(hashBytes);
        }

        public bool VerifyPassword(string password, string passwordHash)
        {
            var hashBytes = Convert.FromBase64String(passwordHash);

            var salt = new byte[SaltSize];
            Array.Copy(hashBytes, 0, salt, 0, SaltSize);

            var hash = Rfc2898DeriveBytes.Pbkdf2(
                password,
                salt,
                Iterations,
                HashAlgorithmName.SHA512,
                HashSize);

            // Constant-time comparison prevents timing-based side-channel attacks.
            return CryptographicOperations.FixedTimeEquals(
                hash.AsSpan(),
                hashBytes.AsSpan(SaltSize, HashSize));
        }

        public bool NeedsRehash(string passwordHash)
        {
            // Можно добавить проверку версии алгоритма
            return false;
        }
    }
}

namespace Planora.Auth.Infrastructure.Services.Authentication
{
    public sealed class PasswordHasher : IPasswordHasher
    {
        private const int SaltSize = 16;
        private const int HashSize = 32;
        private const int Iterations = 100000;

        public string HashPassword(string password)
        {
            using var algorithm = new Rfc2898DeriveBytes(
                password,
                SaltSize,
                Iterations,
                HashAlgorithmName.SHA512);

            var salt = algorithm.Salt;
            var hash = algorithm.GetBytes(HashSize);

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

            using var algorithm = new Rfc2898DeriveBytes(
                password,
                salt,
                Iterations,
                HashAlgorithmName.SHA512);

            var hash = algorithm.GetBytes(HashSize);

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

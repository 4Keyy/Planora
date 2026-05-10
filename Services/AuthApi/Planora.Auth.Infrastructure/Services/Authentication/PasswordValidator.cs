namespace Planora.Auth.Infrastructure.Services.Authentication
{
    public sealed class PasswordValidator : IPasswordValidator
    {
        private readonly ILogger<PasswordValidator> _logger;
        private readonly IPasswordHistoryRepository _passwordHistoryRepository;
        private readonly IPasswordHasher _passwordHasher;
        private readonly HttpClient _httpClient;
        private readonly IConfiguration _configuration;

        private const string PwnedPasswordsApiUrl = "https://api.pwnedpasswords.com/range/";

        public PasswordValidator(
            ILogger<PasswordValidator> logger,
            IPasswordHistoryRepository passwordHistoryRepository,
            IPasswordHasher passwordHasher,
            IHttpClientFactory httpClientFactory,
            IConfiguration configuration)
        {
            _logger = logger;
            _passwordHistoryRepository = passwordHistoryRepository;
            _passwordHasher = passwordHasher;
            _httpClient = httpClientFactory.CreateClient();
            _httpClient.Timeout = TimeSpan.FromSeconds(5);
            _configuration = configuration;
        }

        public bool IsStrongPassword(string password)
        {
            if (string.IsNullOrEmpty(password))
                return false;

            var minLength = _configuration.GetValue("Password:RequiredLength", 8);
            var requireUppercase = _configuration.GetValue("Password:RequireUppercase", true);
            var requireLowercase = _configuration.GetValue("Password:RequireLowercase", true);
            var requireDigit = _configuration.GetValue("Password:RequireDigit", true);
            var requireSpecial = _configuration.GetValue("Password:RequireSpecialCharacter", true);
            var maxLength = _configuration.GetValue("Password:MaxLength", 128);

            if (password.Length < minLength || password.Length > maxLength)
                return false;

            if (requireUppercase && !password.Any(char.IsUpper))
                return false;

            if (requireLowercase && !password.Any(char.IsLower))
                return false;

            if (requireDigit && !password.Any(char.IsDigit))
                return false;

            if (requireSpecial && !password.Any(ch => !char.IsLetterOrDigit(ch)))
                return false;

            var weakPasswords = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "password", "12345678", "qwerty", "abc12345", "password123",
                "admin", "letmein", "welcome", "monkey", "dragon"
            };

            var normalizedPassword = new string(password.Where(char.IsLetterOrDigit).ToArray());
            if (weakPasswords.Contains(password) || weakPasswords.Contains(normalizedPassword))
                return false;

            if (HasSequentialCharacters(password, 4))
                return false;

            if (HasRepeatingCharacters(password, 4))
                return false;

            return true;
        }

        public async Task<bool> IsPasswordCompromisedAsync(
            string password,
            CancellationToken cancellationToken = default)
        {
            if (!_configuration.GetValue("Password:CheckCompromised", true))
                return false;

            try
            {
                using var sha1 = SHA1.Create();
                var hashBytes = sha1.ComputeHash(Encoding.UTF8.GetBytes(password));
                var hash = BitConverter.ToString(hashBytes).Replace("-", "").ToUpper();

                var prefix = hash.Substring(0, 5);
                var suffix = hash.Substring(5);

                var response = await _httpClient.GetAsync(
                    $"{PwnedPasswordsApiUrl}{prefix}",
                    cancellationToken);

                if (!response.IsSuccessStatusCode)
                {
                    _logger.LogWarning("Failed to check password against HIBP API: {StatusCode}",
                        response.StatusCode);
                    return false;
                }

                var content = await response.Content.ReadAsStringAsync(cancellationToken);
                var hashes = content.Split('\n', StringSplitOptions.RemoveEmptyEntries);

                var isCompromised = hashes.Any(line =>
                    line.StartsWith(suffix, StringComparison.OrdinalIgnoreCase));

                if (isCompromised)
                {
                    _logger.LogWarning("Password found in breach database");
                }

                return isCompromised;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error checking password compromise");
                return false;
            }
        }

        public async Task<bool> IsDifferentFromPreviousPasswordsAsync(
            Guid userId,
            string newPassword,
            int count = 5,
            CancellationToken cancellationToken = default)
        {
            try
            {
                var passwordHistoryLimit = _configuration.GetValue("Password:PasswordHistoryLimit", 5);
                var previousPasswords = await _passwordHistoryRepository.GetByUserIdAsync(
                    userId,
                    passwordHistoryLimit,
                    cancellationToken);

                foreach (var history in previousPasswords)
                {
                    if (_passwordHasher.VerifyPassword(newPassword, history.PasswordHash))
                    {
                        _logger.LogWarning(
                            "User {UserId} attempted to reuse a previous password",
                            userId);
                        return false;
                    }
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error checking password history for user: {UserId}", userId);
                return true;
            }
        }

        public int CalculatePasswordStrength(string password)
        {
            if (string.IsNullOrEmpty(password))
                return 0;

            var score = 0;

            if (password.Length >= 8) score++;
            if (password.Length >= 12) score++;
            if (password.Length >= 16) score++;

            if (password.Any(char.IsUpper)) score++;
            if (password.Any(char.IsLower)) score++;
            if (password.Any(char.IsDigit)) score++;
            if (password.Any(ch => !char.IsLetterOrDigit(ch))) score++;

            var uniqueChars = password.Distinct().Count();
            if (uniqueChars >= password.Length * 0.7) score++;

            if (!HasSequentialCharacters(password, 3)) score++;
            if (!HasRepeatingCharacters(password, 3)) score++;

            return Math.Min(score, 10);
        }

        private bool HasSequentialCharacters(string password, int length)
        {
            for (int i = 0; i <= password.Length - length; i++)
            {
                var sequential = true;
                for (int j = 1; j < length; j++)
                {
                    if (password[i + j] != password[i + j - 1] + 1)
                    {
                        sequential = false;
                        break;
                    }
                }
                if (sequential) return true;
            }
            return false;
        }

        private bool HasRepeatingCharacters(string password, int length)
        {
            for (int i = 0; i <= password.Length - length; i++)
            {
                if (password.Skip(i).Take(length).Distinct().Count() == 1)
                    return true;
            }
            return false;
        }
    }
}

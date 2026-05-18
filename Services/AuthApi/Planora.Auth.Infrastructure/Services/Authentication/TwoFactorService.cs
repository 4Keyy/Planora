using OtpNet;
using QRCoder;
using StackExchange.Redis;

namespace Planora.Auth.Infrastructure.Services.Authentication
{
    public sealed class TwoFactorService : ITwoFactorService
    {
        private const string Issuer = "Planora";
        // TTL covers the full VerificationWindow of ±2 time steps (5 × 30 s = 150 s) plus buffer.
        private static readonly TimeSpan UsedCodeTtl = TimeSpan.FromMinutes(3);

        private readonly IConnectionMultiplexer _redis;
        private readonly ILogger<TwoFactorService> _logger;

        public TwoFactorService(IConnectionMultiplexer redis, ILogger<TwoFactorService> logger)
        {
            _redis = redis;
            _logger = logger;
        }

        public string GenerateSecret()
        {
            var key = KeyGeneration.GenerateRandomKey(20);
            return Base32Encoding.ToString(key);
        }

        public string GenerateQrCodeUrl(string email, string secret)
        {
            var otpUri = $"otpauth://totp/{Issuer}:{email}?secret={secret}&issuer={Issuer}";

            using var qrGenerator = new QRCodeGenerator();
            using var qrCodeData = qrGenerator.CreateQrCode(otpUri, QRCodeGenerator.ECCLevel.Q);
            using var qrCode = new Base64QRCode(qrCodeData);

            return qrCode.GetGraphic(5);
        }

        public async Task<bool> VerifyCodeAsync(
            string secret,
            string code,
            Guid userId,
            CancellationToken cancellationToken = default)
        {
            var secretBytes = Base32Encoding.ToBytes(secret);
            var totp = new Totp(secretBytes);

            // VerifyTotp returns the matched time step via the out parameter.
            // Discarding it (out _) means we cannot track replay; we capture it here.
            var isValid = totp.VerifyTotp(code, out var timeStepMatched, new VerificationWindow(2, 2));

            if (!isValid)
                return false;

            // SECURITY: prevent replay within the same time step window.
            var replayKey = $"totp:used:{userId}:{timeStepMatched}";
            try
            {
                var db = _redis.GetDatabase();
                // SetAsync with NX (only set if not exists) returns true when the key is new.
                var keyWasNew = await db.StringSetAsync(
                    replayKey,
                    "1",
                    UsedCodeTtl,
                    When.NotExists);

                if (!keyWasNew)
                {
                    _logger.LogWarning(
                        "TOTP replay attempt detected for user {UserId} at time step {TimeStep}",
                        userId,
                        timeStepMatched);
                    return false;
                }
            }
            catch (Exception ex)
            {
                // Redis is unavailable — fail closed to prevent replay bypass.
                _logger.LogError(ex,
                    "Redis unavailable for TOTP replay check (user {UserId}); denying code to fail closed",
                    userId);
                return false;
            }

            return true;
        }
    }
}

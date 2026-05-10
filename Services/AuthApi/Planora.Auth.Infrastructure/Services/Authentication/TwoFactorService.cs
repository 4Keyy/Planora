using OtpNet;
using QRCoder;

namespace Planora.Auth.Infrastructure.Services.Authentication
{
    public sealed class TwoFactorService : ITwoFactorService
    {
        private const string Issuer = "Planora";

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

        public bool VerifyCode(string secret, string code)
        {
            var secretBytes = Base32Encoding.ToBytes(secret);
            var totp = new Totp(secretBytes);

            return totp.VerifyTotp(code, out _, new VerificationWindow(2, 2));
        }
    }
}

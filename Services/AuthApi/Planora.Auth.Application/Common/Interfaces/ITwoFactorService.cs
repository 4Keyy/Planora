namespace Planora.Auth.Application.Common.Interfaces
{
    public interface ITwoFactorService
    {
        string GenerateSecret();

        string GenerateQrCodeUrl(string email, string secret);

        bool VerifyCode(string secret, string code);
    }
}

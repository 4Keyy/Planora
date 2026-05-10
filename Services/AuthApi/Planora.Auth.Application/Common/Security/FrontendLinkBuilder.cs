using Planora.Auth.Application.Common.Options;

namespace Planora.Auth.Application.Common.Security;

public static class FrontendLinkBuilder
{
    public static string PasswordReset(FrontendOptions options, string token) =>
        $"{options.GetNormalizedBaseUrl()}/reset-password?token={Uri.EscapeDataString(token)}";

    public static string EmailVerification(FrontendOptions options, string token) =>
        $"{options.GetNormalizedBaseUrl()}/auth/verify-email?token={Uri.EscapeDataString(token)}";
}

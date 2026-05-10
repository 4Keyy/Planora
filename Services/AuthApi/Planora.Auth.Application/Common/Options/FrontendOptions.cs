namespace Planora.Auth.Application.Common.Options;

public sealed class FrontendOptions
{
    public const string SectionName = "Frontend";
    public const string LocalFallbackBaseUrl = "http://localhost:3000";

    public string? BaseUrl { get; set; }

    public string GetNormalizedBaseUrl()
    {
        var baseUrl = string.IsNullOrWhiteSpace(BaseUrl)
            ? LocalFallbackBaseUrl
            : BaseUrl.Trim();

        return baseUrl.TrimEnd('/');
    }
}

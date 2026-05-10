namespace Planora.ApiGateway.DelegatingHandlers;

public sealed class CorrelationIdDelegatingHandler : DelegatingHandler
{
    private const string CorrelationIdHeaderName = "X-Correlation-ID";
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CorrelationIdDelegatingHandler(IHttpContextAccessor httpContextAccessor)
    {
        _httpContextAccessor = httpContextAccessor;
    }

    protected override async Task<HttpResponseMessage> SendAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken)
    {
        var httpContext = _httpContextAccessor.HttpContext;
        if (httpContext != null)
        {
            var correlationId = httpContext.Items[CorrelationIdHeaderName]?.ToString() ??
                               httpContext.Request.Headers[CorrelationIdHeaderName].ToString();

            if (!string.IsNullOrWhiteSpace(correlationId))
            {
                request.Headers.Add(CorrelationIdHeaderName, correlationId);
            }
        }

        return await base.SendAsync(request, cancellationToken);
    }
}

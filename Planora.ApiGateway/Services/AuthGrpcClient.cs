namespace Planora.ApiGateway.Services;

public sealed class AuthGrpcClient : IAuthGrpcClient
{
    private readonly GrpcContracts.AuthService.AuthServiceClient _client;
    private readonly ILogger<AuthGrpcClient> _logger;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public AuthGrpcClient(
        GrpcContracts.AuthService.AuthServiceClient client,
        ILogger<AuthGrpcClient> logger,
        IHttpContextAccessor httpContextAccessor)
    {
        _client = client;
        _logger = logger;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task<bool> ValidateTokenAsync(string token, CancellationToken cancellationToken = default)
    {
        try
        {
            var request = new GrpcContracts.ValidateTokenRequest { Token = token };

            // Add correlation ID to metadata
            var metadata = new Grpc.Core.Metadata();
            var httpContext = _httpContextAccessor.HttpContext;
            if (httpContext != null)
            {
                var correlationId = httpContext.Items["X-Correlation-ID"]?.ToString() ??
                                   httpContext.Request.Headers["X-Correlation-ID"].ToString();
                if (!string.IsNullOrWhiteSpace(correlationId))
                {
                    metadata.Add("X-Correlation-ID", correlationId);
                }
            }

            var callOptions = new Grpc.Core.CallOptions(cancellationToken: cancellationToken)
                .WithHeaders(metadata);

            var response = await _client.ValidateTokenAsync(request, callOptions);
            return response.IsValid;
        }
        catch (Grpc.Core.RpcException ex) when (ex.StatusCode == Grpc.Core.StatusCode.DeadlineExceeded)
        {
            _logger.LogWarning("gRPC timeout while validating token");
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error validating token via gRPC");
            return false;
        }
    }
}
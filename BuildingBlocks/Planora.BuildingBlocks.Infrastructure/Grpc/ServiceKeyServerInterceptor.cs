using Grpc.Core;
using Grpc.Core.Interceptors;
using System.Security.Cryptography;
using System.Text;

namespace Planora.BuildingBlocks.Infrastructure.Grpc;

/// <summary>
/// Server-side gRPC interceptor that validates the x-service-key metadata header.
/// Prevents unauthenticated access to internal gRPC endpoints from outside the service mesh.
/// </summary>
public sealed class ServiceKeyServerInterceptor : Interceptor
{
    private readonly byte[] _expectedKeyBytes;
    private readonly ILogger<ServiceKeyServerInterceptor> _logger;

    public ServiceKeyServerInterceptor(IConfiguration configuration, ILogger<ServiceKeyServerInterceptor> logger)
    {
        var key = configuration["GrpcSettings:ServiceKey"]
            ?? throw new InvalidOperationException("GrpcSettings:ServiceKey is not configured");
        _expectedKeyBytes = Encoding.UTF8.GetBytes(key);
        _logger = logger;
    }

    public override async Task<TResponse> UnaryServerHandler<TRequest, TResponse>(
        TRequest request,
        ServerCallContext context,
        UnaryServerMethod<TRequest, TResponse> continuation)
    {
        ValidateServiceKey(context);
        return await continuation(request, context);
    }

    public override async Task<TResponse> ClientStreamingServerHandler<TRequest, TResponse>(
        IAsyncStreamReader<TRequest> requestStream,
        ServerCallContext context,
        ClientStreamingServerMethod<TRequest, TResponse> continuation)
    {
        ValidateServiceKey(context);
        return await continuation(requestStream, context);
    }

    public override async Task ServerStreamingServerHandler<TRequest, TResponse>(
        TRequest request,
        IServerStreamWriter<TResponse> responseStream,
        ServerCallContext context,
        ServerStreamingServerMethod<TRequest, TResponse> continuation)
    {
        ValidateServiceKey(context);
        await continuation(request, responseStream, context);
    }

    public override async Task DuplexStreamingServerHandler<TRequest, TResponse>(
        IAsyncStreamReader<TRequest> requestStream,
        IServerStreamWriter<TResponse> responseStream,
        ServerCallContext context,
        DuplexStreamingServerMethod<TRequest, TResponse> continuation)
    {
        ValidateServiceKey(context);
        await continuation(requestStream, responseStream, context);
    }

    private void ValidateServiceKey(ServerCallContext context)
    {
        var key = context.RequestHeaders.GetValue("x-service-key");
        if (key is null)
        {
            _logger.LogWarning("gRPC call rejected: missing x-service-key header | Method: {Method}", context.Method);
            throw new RpcException(new Status(StatusCode.Unauthenticated, "Service key required"));
        }

        var actualKeyBytes = Encoding.UTF8.GetBytes(key);
        if (actualKeyBytes.Length != _expectedKeyBytes.Length ||
            !CryptographicOperations.FixedTimeEquals(actualKeyBytes, _expectedKeyBytes))
        {
            _logger.LogWarning("gRPC call rejected: invalid x-service-key | Method: {Method}", context.Method);
            throw new RpcException(new Status(StatusCode.Unauthenticated, "Invalid service key"));
        }
    }
}

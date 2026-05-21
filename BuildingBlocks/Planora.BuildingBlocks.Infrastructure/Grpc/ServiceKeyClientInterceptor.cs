using Grpc.Core;
using Grpc.Core.Interceptors;

namespace Planora.BuildingBlocks.Infrastructure.Grpc;

/// <summary>
/// Client-side gRPC interceptor that injects the x-service-key header into outgoing calls.
/// Must be registered on every gRPC client that calls services protected by ServiceKeyServerInterceptor.
/// </summary>
public sealed class ServiceKeyClientInterceptor : Interceptor
{
    private readonly string _serviceKey;

    public ServiceKeyClientInterceptor(IConfiguration configuration)
    {
        _serviceKey = configuration["GrpcSettings:ServiceKey"]
            ?? throw new InvalidOperationException("GrpcSettings:ServiceKey is not configured");
        if (_serviceKey.Length < 16)
            throw new InvalidOperationException("GrpcSettings:ServiceKey must be at least 16 characters long.");
    }

    public override AsyncUnaryCall<TResponse> AsyncUnaryCall<TRequest, TResponse>(
        TRequest request,
        ClientInterceptorContext<TRequest, TResponse> context,
        AsyncUnaryCallContinuation<TRequest, TResponse> continuation)
    {
        return continuation(request, AddServiceKeyHeader(context));
    }

    public override AsyncClientStreamingCall<TRequest, TResponse> AsyncClientStreamingCall<TRequest, TResponse>(
        ClientInterceptorContext<TRequest, TResponse> context,
        AsyncClientStreamingCallContinuation<TRequest, TResponse> continuation)
    {
        return continuation(AddServiceKeyHeader(context));
    }

    public override AsyncServerStreamingCall<TResponse> AsyncServerStreamingCall<TRequest, TResponse>(
        TRequest request,
        ClientInterceptorContext<TRequest, TResponse> context,
        AsyncServerStreamingCallContinuation<TRequest, TResponse> continuation)
    {
        return continuation(request, AddServiceKeyHeader(context));
    }

    public override AsyncDuplexStreamingCall<TRequest, TResponse> AsyncDuplexStreamingCall<TRequest, TResponse>(
        ClientInterceptorContext<TRequest, TResponse> context,
        AsyncDuplexStreamingCallContinuation<TRequest, TResponse> continuation)
    {
        return continuation(AddServiceKeyHeader(context));
    }

    private ClientInterceptorContext<TRequest, TResponse> AddServiceKeyHeader<TRequest, TResponse>(
        ClientInterceptorContext<TRequest, TResponse> context)
        where TRequest : class
        where TResponse : class
    {
        var headers = context.Options.Headers ?? new Metadata();
        if (headers.All(h => !h.Key.Equals("x-service-key", StringComparison.OrdinalIgnoreCase)))
            headers.Add("x-service-key", _serviceKey);

        var newOptions = context.Options.WithHeaders(headers);
        return new ClientInterceptorContext<TRequest, TResponse>(context.Method, context.Host, newOptions);
    }
}

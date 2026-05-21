using Grpc.Core;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Planora.BuildingBlocks.Infrastructure.Grpc;

namespace Planora.UnitTests.BuildingBlocks.Grpc;

public class ServiceKeyInterceptorTests
{
    private const string ValidKey = "this-is-a-valid-service-key-0123456789";

    private static IConfiguration Config(string? key) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["GrpcSettings:ServiceKey"] = key
            })
            .Build();

    [Fact]
    public void ServerInterceptor_Throws_WhenKeyMissing()
    {
        Assert.Throws<InvalidOperationException>(() =>
            new ServiceKeyServerInterceptor(Config(null), NullLogger<ServiceKeyServerInterceptor>.Instance));
    }

    [Fact]
    public void ServerInterceptor_Throws_WhenKeyTooShort()
    {
        Assert.Throws<InvalidOperationException>(() =>
            new ServiceKeyServerInterceptor(Config("short-key"), NullLogger<ServiceKeyServerInterceptor>.Instance));
    }

    [Fact]
    public void ClientInterceptor_Throws_WhenKeyMissing()
    {
        Assert.Throws<InvalidOperationException>(() => new ServiceKeyClientInterceptor(Config(null)));
    }

    [Fact]
    public void ClientInterceptor_Throws_WhenKeyTooShort()
    {
        Assert.Throws<InvalidOperationException>(() => new ServiceKeyClientInterceptor(Config("short-key")));
    }

    [Fact]
    public async Task ServerInterceptor_Rejects_WhenServiceKeyHeaderMissing()
    {
        var interceptor = new ServiceKeyServerInterceptor(
            Config(ValidKey), NullLogger<ServiceKeyServerInterceptor>.Instance);

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            interceptor.UnaryServerHandler<string, string>(
                "req", new HeaderCallContext(new Metadata()), (_, _) => Task.FromResult("ok")));

        Assert.Equal(StatusCode.Unauthenticated, ex.StatusCode);
    }

    [Fact]
    public async Task ServerInterceptor_Rejects_WhenServiceKeyInvalid()
    {
        var interceptor = new ServiceKeyServerInterceptor(
            Config(ValidKey), NullLogger<ServiceKeyServerInterceptor>.Instance);
        var headers = new Metadata { { "x-service-key", "wrong-but-long-enough-key" } };

        var ex = await Assert.ThrowsAsync<RpcException>(() =>
            interceptor.UnaryServerHandler<string, string>(
                "req", new HeaderCallContext(headers), (_, _) => Task.FromResult("ok")));

        Assert.Equal(StatusCode.Unauthenticated, ex.StatusCode);
    }

    [Fact]
    public async Task ServerInterceptor_Allows_WhenServiceKeyMatches()
    {
        var interceptor = new ServiceKeyServerInterceptor(
            Config(ValidKey), NullLogger<ServiceKeyServerInterceptor>.Instance);
        var headers = new Metadata { { "x-service-key", ValidKey } };

        var result = await interceptor.UnaryServerHandler<string, string>(
            "req", new HeaderCallContext(headers), (_, _) => Task.FromResult("ok"));

        Assert.Equal("ok", result);
    }

    [Fact]
    public void ClientInterceptor_InjectsServiceKeyHeader_OnAsyncUnaryCall()
    {
        var interceptor = new ServiceKeyClientInterceptor(Config(ValidKey));
        var method = new Method<string, string>(
            MethodType.Unary, "TestService", "TestMethod",
            Marshallers.StringMarshaller, Marshallers.StringMarshaller);
        var context = new ClientInterceptorContext<string, string>(
            method, "localhost", new CallOptions());
        ClientInterceptorContext<string, string>? captured = null;

        interceptor.AsyncUnaryCall(
            "req",
            context,
            (_, ctx) =>
            {
                captured = ctx;
                return new AsyncUnaryCall<string>(
                    Task.FromResult("ok"),
                    Task.FromResult(new Metadata()),
                    () => Status.DefaultSuccess,
                    () => new Metadata(),
                    () => { });
            });

        Assert.NotNull(captured);
        var header = captured!.Value.Options.Headers?.FirstOrDefault(
            h => h.Key.Equals("x-service-key", StringComparison.OrdinalIgnoreCase));
        Assert.NotNull(header);
        Assert.Equal(ValidKey, header!.Value);
    }

    [Fact]
    public void ClientInterceptor_DoesNotDuplicateHeader_WhenAlreadyPresent()
    {
        var interceptor = new ServiceKeyClientInterceptor(Config(ValidKey));
        var method = new Method<string, string>(
            MethodType.Unary, "TestService", "TestMethod",
            Marshallers.StringMarshaller, Marshallers.StringMarshaller);
        var existingHeaders = new Metadata { { "x-service-key", "already-set-key-for-idempotency" } };
        var context = new ClientInterceptorContext<string, string>(
            method, "localhost", new CallOptions(headers: existingHeaders));
        ClientInterceptorContext<string, string>? captured = null;

        interceptor.AsyncUnaryCall(
            "req",
            context,
            (_, ctx) =>
            {
                captured = ctx;
                return new AsyncUnaryCall<string>(
                    Task.FromResult("ok"),
                    Task.FromResult(new Metadata()),
                    () => Status.DefaultSuccess,
                    () => new Metadata(),
                    () => { });
            });

        Assert.NotNull(captured);
        var serviceKeyHeaders = captured!.Value.Options.Headers?
            .Where(h => h.Key.Equals("x-service-key", StringComparison.OrdinalIgnoreCase))
            .ToList();
        Assert.NotNull(serviceKeyHeaders);
        Assert.Single(serviceKeyHeaders!);
        Assert.Equal("already-set-key-for-idempotency", serviceKeyHeaders![0].Value);
    }

    private sealed class HeaderCallContext : ServerCallContext
    {
        public HeaderCallContext(Metadata headers) => RequestHeadersCore = headers;

        protected override Metadata RequestHeadersCore { get; }
        protected override string MethodCore => "Test";
        protected override string HostCore => "localhost";
        protected override string PeerCore => "127.0.0.1";
        protected override DateTime DeadlineCore => DateTime.MaxValue;
        protected override CancellationToken CancellationTokenCore => CancellationToken.None;
        protected override Metadata ResponseTrailersCore { get; } = new();
        protected override Status StatusCore { get; set; }
        protected override WriteOptions? WriteOptionsCore { get; set; }
        protected override AuthContext AuthContextCore =>
            new(null, new Dictionary<string, List<AuthProperty>>());
        protected override Task WriteResponseHeadersAsyncCore(Metadata responseHeaders) => Task.CompletedTask;
        protected override ContextPropagationToken CreatePropagationTokenCore(ContextPropagationOptions? options) => null!;
    }
}

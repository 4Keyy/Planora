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

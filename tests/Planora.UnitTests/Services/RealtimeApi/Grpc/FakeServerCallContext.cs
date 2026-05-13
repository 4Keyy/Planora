using Grpc.Core;

namespace Planora.UnitTests.Services.RealtimeApi.Grpc;

internal sealed class FakeServerCallContext : ServerCallContext
{
    private readonly CancellationToken _cancellationToken;

    internal FakeServerCallContext(CancellationToken cancellationToken = default)
    {
        _cancellationToken = cancellationToken;
    }

    protected override string MethodCore => "FakeMethod";
    protected override string HostCore => "localhost";
    protected override DateTime DeadlineCore => DateTime.MaxValue;
    protected override Metadata RequestHeadersCore => [];
    protected override CancellationToken CancellationTokenCore => _cancellationToken;
    protected override Metadata ResponseTrailersCore => [];
    protected override Status StatusCore { get; set; }
    protected override WriteOptions? WriteOptionsCore { get; set; }
    protected override AuthContext AuthContextCore =>
        new(null, new Dictionary<string, List<AuthProperty>>());
    protected override string PeerCore => "127.0.0.1";
    protected override Task WriteResponseHeadersAsyncCore(Metadata responseHeaders) => Task.CompletedTask;
    protected override ContextPropagationToken CreatePropagationTokenCore(ContextPropagationOptions options) => null!;
}

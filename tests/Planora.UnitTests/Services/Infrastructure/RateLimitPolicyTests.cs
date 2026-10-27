using System.Net;
using System.Security.Claims;
using System.Text.Json;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Planora.BuildingBlocks.Infrastructure.Extensions;
using RateLimits = Planora.BuildingBlocks.Infrastructure.Extensions.ServiceCollectionExtensions;

namespace Planora.UnitTests.Services.Infrastructure;

/// <summary>
/// Pins down what the shared rate limiter actually lets through. The app used to answer 429 after
/// 15–30 seconds of ordinary use: every service ran <c>UseRateLimiter()</c> before
/// <c>UseAuthentication()</c>, so each request looked anonymous, carried the gateway's address and
/// landed in one bucket that every user shared — and on Redis that bucket was one key for all
/// services at once.
/// </summary>
public sealed class RateLimitPolicyTests
{
    private static readonly string[] ServicePrograms =
    [
        "Services/AuthApi/Planora.Auth.Api/Program.cs",
        "Services/CategoryApi/Planora.Category.Api/Program.cs",
        "Services/CollaborationApi/Planora.Collaboration.Api/Program.cs",
        "Services/MessagingApi/Planora.Messaging.Api/Program.cs",
        "Services/RealtimeApi/Planora.Realtime.Api/Program.cs",
        "Services/TodoApi/Planora.Todo.Api/Program.cs",
        "Planora.ApiGateway/Program.cs",
    ];

    [Theory]
    [MemberData(nameof(Programs))]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void Pipeline_RunsTheLimiterAfterAuthentication(string program)
    {
        var source = File.ReadAllText(Path.Combine(FindRepositoryRoot(), program));

        var authentication = source.IndexOf("app.UseAuthentication();", StringComparison.Ordinal);
        var limiter = source.IndexOf("app.UseRateLimiter();", StringComparison.Ordinal);

        Assert.True(authentication >= 0, $"{program} must call UseAuthentication()");
        Assert.True(limiter >= 0, $"{program} must call UseRateLimiter()");
        Assert.True(
            limiter > authentication,
            $"{program} runs UseRateLimiter() before UseAuthentication(): every user would share the gateway's bucket.");
    }

    public static TheoryData<string> Programs()
    {
        var data = new TheoryData<string>();
        foreach (var program in ServicePrograms) data.Add(program);
        return data;
    }

    [Fact]
    [Trait("TestType", "Security")]
    [Trait("TestType", "Regression")]
    public void GlobalLimiter_GivesEverySignedInUserTheirOwnAllowance_BehindOneAddress()
    {
        var limiter = BuildOptions().GlobalLimiter!;
        var gateway = IPAddress.Loopback;

        for (var i = 0; i < RateLimits.GlobalPermitsPerMinute; i++)
        {
            using var lease = limiter.AttemptAcquire(Request(gateway, user: "alice"));
            Assert.True(lease.IsAcquired, $"request {i + 1} of the allowance was refused");
        }

        using (var over = limiter.AttemptAcquire(Request(gateway, user: "alice")))
        {
            Assert.False(over.IsAcquired);
            Assert.InRange(RateLimits.RetryAfterSeconds(over), 1, 60);
        }

        // Same address, another person: untouched by Alice's spending.
        using var bob = limiter.AttemptAcquire(Request(gateway, user: "bob"));
        Assert.True(bob.IsAcquired);
        using var anonymous = limiter.AttemptAcquire(Request(gateway, user: null));
        Assert.True(anonymous.IsAcquired);
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public void GlobalLimiter_AllowsTwoAndAHalfTimesTheOldCeiling()
    {
        Assert.Equal(250, RateLimits.GlobalPermitsPerMinute);
    }

    [Theory]
    [InlineData("auth", 20, 60)]
    [InlineData("login", 10, 60)]
    [InlineData("register", 6, 60)]
    [InlineData("data", 125, 60)]
    [InlineData("avatar-upload", 10, 3600)]
    [InlineData("client-errors", 50, 60)]
    [Trait("TestType", "Security")]
    public void NamedPolicies_HaveTheDocumentedLimits(string name, int permits, int windowSeconds)
    {
        var policy = Assert.Single(RateLimits.NamedPolicies, p => p.Name == name);

        Assert.Equal(permits, policy.PermitLimit);
        Assert.Equal(TimeSpan.FromSeconds(windowSeconds), policy.Window);
    }

    [Fact]
    [Trait("TestType", "Security")]
    public void NamedPolicies_AreAllRegistered()
    {
        var options = BuildOptions();
        var policyMap = typeof(RateLimiterOptions)
            .GetProperty("PolicyMap", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?
            .GetValue(options) as System.Collections.IDictionary;

        Assert.NotNull(policyMap);
        foreach (var (name, _, _) in RateLimits.NamedPolicies)
        {
            Assert.True(policyMap!.Contains(name), $"policy '{name}' is not registered");
        }
    }

    [Fact]
    public void RetryAfterSeconds_RoundsTheLeaseUp()
    {
        Assert.Equal(13, RateLimits.RetryAfterSeconds(new StubLease(TimeSpan.FromSeconds(12.2))));
        Assert.Equal(1, RateLimits.RetryAfterSeconds(new StubLease(TimeSpan.FromMilliseconds(40))));
    }

    [Fact]
    public void RetryAfterSeconds_FallsBackWithoutMetadata()
    {
        Assert.Equal(60, RateLimits.RetryAfterSeconds(new StubLease(null)));
        Assert.Equal(60, RateLimits.RetryAfterSeconds(new StubLease(TimeSpan.Zero)));
    }

    [Fact]
    public async Task Rejection_SaysHowLongToWait_InTheHeaderAndTheBody()
    {
        var context = new DefaultHttpContext();
        context.Response.Body = new MemoryStream();

        await RateLimits.WriteRateLimitRejectionAsync(context, new StubLease(TimeSpan.FromSeconds(7.5)));

        Assert.Equal(StatusCodes.Status429TooManyRequests, context.Response.StatusCode);
        Assert.Equal("8", context.Response.Headers.RetryAfter.ToString());
        context.Response.Body.Position = 0;
        using var body = await JsonDocument.ParseAsync(context.Response.Body);
        Assert.Equal(8, body.RootElement.GetProperty("retryAfter").GetInt32());
        Assert.False(string.IsNullOrWhiteSpace(body.RootElement.GetProperty("error").GetString()));
    }

    [Fact]
    [Trait("TestType", "Regression")]
    public void Scope_KeepsEachServicesRedisCountersApart()
    {
        Assert.Equal("planora.todo.api", RateLimits.RateLimitScope(Config(("applicationName", "Planora.Todo.Api"))));
        Assert.Equal(
            "edge",
            RateLimits.RateLimitScope(Config(("applicationName", "Planora.Todo.Api"), ("RateLimiting:Scope", " Edge "))));
        Assert.False(string.IsNullOrWhiteSpace(RateLimits.RateLimitScope(Config())));
    }

    private static RateLimiterOptions BuildOptions()
    {
        var services = new ServiceCollection();
        services.AddConfiguredRateLimiting(Config());
        return services.BuildServiceProvider().GetRequiredService<IOptions<RateLimiterOptions>>().Value;
    }

    private static IConfiguration Config(params (string Key, string Value)[] values) =>
        new ConfigurationBuilder()
            .AddInMemoryCollection(values.Select(v => new KeyValuePair<string, string?>(v.Key, v.Value)))
            .Build();

    private static DefaultHttpContext Request(IPAddress remoteIp, string? user)
    {
        var context = new DefaultHttpContext();
        context.Connection.RemoteIpAddress = remoteIp;
        if (user is not null)
        {
            context.User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("sub", user)], "Bearer"));
        }

        return context;
    }

    private static string FindRepositoryRoot()
    {
        var current = AppContext.BaseDirectory;
        while (!string.IsNullOrWhiteSpace(current))
        {
            if (File.Exists(Path.Combine(current, "Planora.sln")))
            {
                return current;
            }

            current = Directory.GetParent(current)?.FullName;
        }

        throw new InvalidOperationException("Could not locate Planora.sln from test base directory.");
    }

    private sealed class StubLease(TimeSpan? retryAfter) : RateLimitLease
    {
        public override bool IsAcquired => false;

        public override IEnumerable<string> MetadataNames =>
            retryAfter is null ? [] : [MetadataName.RetryAfter.Name];

        public override bool TryGetMetadata(string metadataName, out object? metadata)
        {
            if (retryAfter is not null && metadataName == MetadataName.RetryAfter.Name)
            {
                metadata = retryAfter.Value;
                return true;
            }

            metadata = null;
            return false;
        }
    }
}

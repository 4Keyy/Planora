using System.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Planora.BuildingBlocks.Infrastructure.Retention;

namespace Planora.UnitTests.BuildingBlocks.Retention;

/// <summary>
/// Behavioural coverage for the scheduler's startup catch-up pass: on every launch the registered policies
/// must run shortly after start (so data already past its window is cleaned immediately), and the whole
/// scheduler must stay dormant when the subsystem is disabled.
/// </summary>
public sealed class RetentionBackgroundServiceTests
{
    private sealed class RecordingPolicy : IRetentionPolicy
    {
        private int _invocations;
        public int Invocations => Volatile.Read(ref _invocations);

        public string Name => "recording";
        public bool IsEnabled(RetentionOptions options) => true;

        public Task<RetentionResult> ExecuteAsync(IServiceProvider scopedServices, RetentionContext context, CancellationToken cancellationToken)
        {
            Interlocked.Increment(ref _invocations);
            return Task.FromResult(new RetentionResult { PolicyName = Name });
        }
    }

    private static RetentionBackgroundService Build(RecordingPolicy policy, RetentionOptions options)
    {
        var provider = new ServiceCollection().BuildServiceProvider();
        return new RetentionBackgroundService(
            provider, new[] { (IRetentionPolicy)policy }, Options.Create(options), NullLogger<RetentionBackgroundService>.Instance);
    }

    private static async Task<bool> WaitUntilAsync(Func<bool> condition, int timeoutMs = 2000)
    {
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < timeoutMs)
        {
            if (condition()) return true;
            await Task.Delay(10);
        }
        return condition();
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task RunOnStartup_InvokesPoliciesShortlyAfterStart()
    {
        var policy = new RecordingPolicy();
        var service = Build(policy, new RetentionOptions
        {
            Enabled = true, DryRun = true, RunOnStartup = true, StartupDelaySeconds = 0
        });

        await service.StartAsync(CancellationToken.None);
        var ran = await WaitUntilAsync(() => policy.Invocations > 0);
        await service.StopAsync(CancellationToken.None);

        Assert.True(ran, "the startup catch-up pass should invoke the policies");
    }

    [Fact]
    [Trait("TestType", "Unit")]
    public async Task Disabled_NeverInvokesPolicies()
    {
        var policy = new RecordingPolicy();
        var service = Build(policy, new RetentionOptions
        {
            Enabled = false, RunOnStartup = true, StartupDelaySeconds = 0
        });

        await service.StartAsync(CancellationToken.None);
        await Task.Delay(150);
        await service.StopAsync(CancellationToken.None);

        Assert.Equal(0, policy.Invocations);
    }
}

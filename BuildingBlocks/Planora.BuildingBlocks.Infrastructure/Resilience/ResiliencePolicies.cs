using System.Net.Sockets;
using Microsoft.Extensions.Logging;
using Polly;
using Polly.CircuitBreaker;
using Polly.Retry;
using Polly.Timeout;
using Polly.RateLimiting;
using Npgsql;
using RabbitMQ.Client;
using RabbitMQ.Client.Exceptions;
using StackExchange.Redis;

namespace Planora.BuildingBlocks.Infrastructure.Resilience
{
    public static class ResiliencePolicies
    {
        public static ResiliencePipeline CreateRabbitMqRetryPipeline(ILogger logger)
        {
            return new ResiliencePipelineBuilder()
                .AddRetry(new RetryStrategyOptions
                {
                    MaxRetryAttempts = 10,
                    Delay = TimeSpan.FromSeconds(2),
                    BackoffType = DelayBackoffType.Exponential,
                    UseJitter = true,
                    OnRetry = args =>
                    {
                        logger.LogWarning(
                            "RabbitMQ retry attempt {Attempt} after {Delay}ms. Exception: {Exception}",
                            args.AttemptNumber,
                            args.RetryDelay.TotalMilliseconds,
                            args.Outcome.Exception?.Message);
                        return ValueTask.CompletedTask;
                    },
                    ShouldHandle = new PredicateBuilder()
                        .Handle<BrokerUnreachableException>()
                        .Handle<SocketException>()
                        .Handle<TimeoutException>()
                })
                .Build();
        }

        public static ResiliencePipeline CreateRedisRetryPipeline(ILogger logger)
        {
            return new ResiliencePipelineBuilder()
                .AddRetry(new RetryStrategyOptions
                {
                    MaxRetryAttempts = 5,
                    Delay = TimeSpan.FromSeconds(1),
                    BackoffType = DelayBackoffType.Exponential,
                    UseJitter = true,
                    OnRetry = args =>
                    {
                        logger.LogWarning(
                            "Redis retry attempt {Attempt} after {Delay}ms",
                            args.AttemptNumber,
                            args.RetryDelay.TotalMilliseconds);
                        return ValueTask.CompletedTask;
                    },
                    ShouldHandle = new PredicateBuilder()
                        .Handle<RedisConnectionException>()
                        .Handle<RedisTimeoutException>()
                        .Handle<SocketException>()
                })
                .Build();
        }

        public static ResiliencePipeline CreatePostgreSqlRetryPipeline(ILogger logger)
        {
            return new ResiliencePipelineBuilder()
                .AddRetry(new RetryStrategyOptions
                {
                    MaxRetryAttempts = 5,
                    Delay = TimeSpan.FromSeconds(2),
                    BackoffType = DelayBackoffType.Exponential,
                    UseJitter = true,
                    OnRetry = args =>
                    {
                        logger.LogWarning(
                            "PostgreSQL retry attempt {Attempt} after {Delay}ms",
                            args.AttemptNumber,
                            args.RetryDelay.TotalMilliseconds);
                        return ValueTask.CompletedTask;
                    },
                    ShouldHandle = new PredicateBuilder()
                        .Handle<NpgsqlException>()
                        .Handle<SocketException>()
                        .Handle<TimeoutException>()
                })
                .Build();
        }

        public static ResiliencePipeline CreateDefaultCircuitBreakerPipeline(ILogger logger, string serviceName)
        {
            return new ResiliencePipelineBuilder()
                .AddCircuitBreaker(new CircuitBreakerStrategyOptions
                {
                    FailureRatio = 0.5,
                    SamplingDuration = TimeSpan.FromSeconds(10),
                    MinimumThroughput = 10,
                    BreakDuration = TimeSpan.FromSeconds(30),
                    OnOpened = args =>
                    {
                        logger.LogCritical("Circuit Breaker OPENED for {Service}. Duration: {Duration}", serviceName, args.BreakDuration);
                        return ValueTask.CompletedTask;
                    },
                    OnClosed = _ =>
                    {
                        logger.LogInformation("Circuit Breaker CLOSED for {Service}", serviceName);
                        return ValueTask.CompletedTask;
                    }
                })
                .AddTimeout(new TimeoutStrategyOptions { Timeout = TimeSpan.FromSeconds(15) })
                .Build();
        }

        public static ResiliencePipeline CreateBulkheadPipeline(int maxConcurrentCalls, int maxQueuedCalls)
        {
            // Bulkhead isolation to prevent one slow dependency from consuming all resources
            // In Polly v8, this has changed to AddConcurrencyLimiter
            return new ResiliencePipelineBuilder()
                .AddConcurrencyLimiter(maxConcurrentCalls, maxQueuedCalls)
                .Build();
        }
    }
}

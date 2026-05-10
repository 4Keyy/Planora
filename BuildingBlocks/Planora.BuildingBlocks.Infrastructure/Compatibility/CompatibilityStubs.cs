// Exceptions from various client libraries that may not be present at compile time
public class BrokerUnreachableException : Exception { public BrokerUnreachableException() { } public BrokerUnreachableException(string? msg) : base(msg) { } }
public class RedisConnectionException : Exception { public RedisConnectionException() { } public RedisConnectionException(string? msg) : base(msg) { } }
public class RedisTimeoutException : Exception { public RedisTimeoutException() { } public RedisTimeoutException(string? msg) : base(msg) { } }
public class NpgsqlException : Exception { public NpgsqlException() { } public NpgsqlException(string? msg) : base(msg) { } }

// Simple placeholders for Microsoft.Extensions.Resilience / RateLimiter types used in code
public class PartitionedRateLimiter
{
    public static object Create<TContext, TKey>(Func<TContext, object> factory)
    {
        return new object();
    }
}

// Http resilience strategy option stubs
public class HttpTimeoutStrategyOptions { }
public class HttpRetryStrategyOptions { }
public class HttpCircuitBreakerStrategyOptions { }

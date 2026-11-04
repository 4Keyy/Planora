namespace Planora.Auth.Infrastructure.Persistence;

internal static class AuthSessionLock
{
    internal static Task<int> AcquireAsync(AuthDbContext context, Guid userId, CancellationToken cancellationToken)
    {
        var lockName = $"planora.auth.refresh:{userId:N}";
        return context.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended({lockName}, 0))", cancellationToken);
    }
}

using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.Auth.Infrastructure.Persistence;

public static class AuthDatabaseStartup
{
    public const string BaselineMigrationId = "20261103201759_InitialReviewedBaseline";

    public static Task EnsureReadyAsync(AuthDbContext db, ILogger logger, CancellationToken cancellationToken = default) =>
        VersionedDatabaseStartup.EnsureReadyAsync(db, BaselineMigrationId, logger, cancellationToken);
}

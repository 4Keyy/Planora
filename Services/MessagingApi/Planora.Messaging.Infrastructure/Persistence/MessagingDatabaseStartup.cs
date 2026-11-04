using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.Messaging.Infrastructure.Persistence;

public static class MessagingDatabaseStartup
{
    public const string BaselineMigrationId = "20261103201805_InitialReviewedBaseline";

    public static Task EnsureReadyAsync(MessagingDbContext db, ILogger logger, CancellationToken cancellationToken = default) =>
        VersionedDatabaseStartup.EnsureReadyAsync(db, BaselineMigrationId, logger, cancellationToken);
}

using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.Collaboration.Infrastructure.Persistence;

public static class CollaborationDatabaseStartup
{
    public const string BaselineMigrationId = "20261104053345_InitialPreReplyBaseline";
    public const string ReplyReferencesMigrationId = "20261104053426_AddReplyReferences";
    public const string SubtaskActivityIdentityMigrationId = "20261106182312_AddSubtaskActivityIdentity";

    public static Task EnsureReadyAsync(CollaborationDbContext db, ILogger logger, CancellationToken cancellationToken = default) =>
        VersionedDatabaseStartup.EnsureReadyAsync(db, BaselineMigrationId, logger, cancellationToken, SubtaskActivityIdentityMigrationId);
}

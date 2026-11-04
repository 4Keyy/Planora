using Microsoft.Extensions.Logging;
using Planora.BuildingBlocks.Infrastructure.Persistence;

namespace Planora.Category.Infrastructure.Persistence;

public static class CategoryDatabaseStartup
{
    public const string BaselineMigrationId = "20261103201802_InitialReviewedBaseline";

    public static Task EnsureReadyAsync(CategoryDbContext db, ILogger logger, CancellationToken cancellationToken = default) =>
        VersionedDatabaseStartup.EnsureReadyAsync(db, BaselineMigrationId, logger, cancellationToken);
}

using Microsoft.Extensions.Logging;
using Npgsql;

namespace Planora.Migrator;

/// <summary>
/// One-shot, idempotent schema upgrade adding the reply-reference columns to
/// <c>collaboration.comments</c>. Needed only for databases created BEFORE the reply
/// feature shipped: Collaboration has no committed EF migrations (the schema comes from
/// <c>EnsureCreatedAsync</c> on first run), and EnsureCreated never alters an existing
/// schema. Fresh installs get these columns automatically and never need this command.
///
/// Usage: Planora.Migrator --upgrade-collaboration-replies
/// Connection string: ConnectionStrings__CollaborationDatabase.
/// </summary>
internal static class CollaborationRepliesUpgrade
{
    public static async Task<bool> RunAsync(
        string collaborationConnectionString,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        await using var connection = new NpgsqlConnection(collaborationConnectionString);
        await connection.OpenAsync(cancellationToken);

        // Mirrors CommentConfiguration exactly: string-stored enum (16), author name (200),
        // preview (Comment.ReplyPreviewMaxLength = 300), NOT NULL flag with FALSE default,
        // and the (TaskId, ReplyToId) index used by the SubtaskDeleted reply-quote cascade.
        const string upgradeSql = """
            ALTER TABLE collaboration.comments
                ADD COLUMN IF NOT EXISTS "ReplyToType"       character varying(16)  NULL,
                ADD COLUMN IF NOT EXISTS "ReplyToId"         uuid                   NULL,
                ADD COLUMN IF NOT EXISTS "ReplyToAuthorId"   uuid                   NULL,
                ADD COLUMN IF NOT EXISTS "ReplyToAuthorName" character varying(200) NULL,
                ADD COLUMN IF NOT EXISTS "ReplyToPreview"    character varying(300) NULL,
                ADD COLUMN IF NOT EXISTS "ReplyToDeleted"    boolean NOT NULL DEFAULT FALSE;

            CREATE INDEX IF NOT EXISTS "IX_comments_TaskId_ReplyToId"
                ON collaboration.comments ("TaskId", "ReplyToId");
            """;

        await using var command = new NpgsqlCommand(upgradeSql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);

        logger.LogInformation(
            "Collaboration replies upgrade complete: reply columns + (TaskId, ReplyToId) index are present.");
        return true;
    }
}

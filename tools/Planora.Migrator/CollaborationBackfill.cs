using Microsoft.Extensions.Logging;
using Npgsql;

namespace Planora.Migrator;

/// <summary>
/// One-shot, idempotent backfill of the task comment timeline from the legacy
/// <c>todo.todo_item_comments</c> table (TodoApi) into <c>collaboration.comments</c>
/// (Collaboration service). Run AFTER both schemas exist and BEFORE flipping the
/// frontend to the Collaboration routes; safe to run twice (INSERT ... ON CONFLICT
/// (Id) DO NOTHING captures rows created in the cutover window).
///
/// Usage: Planora.Migrator --backfill-collaboration
/// Connection strings: ConnectionStrings__TodoDatabase, ConnectionStrings__CollaborationDatabase.
/// </summary>
internal static class CollaborationBackfill
{
    private const int BatchSize = 500;

    public static async Task<bool> RunAsync(
        string todoConnectionString,
        string collaborationConnectionString,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        await using var source = new NpgsqlConnection(todoConnectionString);
        await using var target = new NpgsqlConnection(collaborationConnectionString);
        await source.OpenAsync(cancellationToken);
        await target.OpenAsync(cancellationToken);

        const string selectSql = """
            SELECT "Id", "TodoItemId", "AuthorId", "AuthorName", "Content",
                   "IsSystemComment", "IsGenesisComment", "CreatedAt", "CreatedBy",
                   "UpdatedAt", "UpdatedBy", "IsDeleted", "DeletedAt", "DeletedBy"
            FROM todo.todo_item_comments
            """;

        const string insertSql = """
            INSERT INTO collaboration.comments
                ("Id", "TaskId", "AuthorId", "AuthorName", "Content",
                 "IsSystemComment", "IsGenesisComment", "CreatedAt", "CreatedBy",
                 "UpdatedAt", "UpdatedBy", "IsDeleted", "DeletedAt", "DeletedBy")
            VALUES (@Id, @TaskId, @AuthorId, @AuthorName, @Content,
                    @IsSystemComment, @IsGenesisComment, @CreatedAt, @CreatedBy,
                    @UpdatedAt, @UpdatedBy, @IsDeleted, @DeletedAt, @DeletedBy)
            ON CONFLICT ("Id") DO NOTHING
            """;

        long read = 0, inserted = 0;

        await using var selectCmd = new NpgsqlCommand(selectSql, source);
        await using var reader = await selectCmd.ExecuteReaderAsync(cancellationToken);

        while (await reader.ReadAsync(cancellationToken))
        {
            read++;
            await using var insert = new NpgsqlCommand(insertSql, target);
            insert.Parameters.AddWithValue("Id", reader.GetGuid(0));
            insert.Parameters.AddWithValue("TaskId", reader.GetGuid(1));
            insert.Parameters.AddWithValue("AuthorId", reader.GetGuid(2));
            insert.Parameters.AddWithValue("AuthorName", reader.GetString(3));
            insert.Parameters.AddWithValue("Content", reader.GetString(4));
            insert.Parameters.AddWithValue("IsSystemComment", reader.GetBoolean(5));
            insert.Parameters.AddWithValue("IsGenesisComment", reader.GetBoolean(6));
            insert.Parameters.AddWithValue("CreatedAt", reader.GetDateTime(7));
            insert.Parameters.AddWithValue("CreatedBy", reader.IsDBNull(8) ? DBNull.Value : reader.GetGuid(8));
            insert.Parameters.AddWithValue("UpdatedAt", reader.IsDBNull(9) ? DBNull.Value : reader.GetDateTime(9));
            insert.Parameters.AddWithValue("UpdatedBy", reader.IsDBNull(10) ? DBNull.Value : reader.GetGuid(10));
            insert.Parameters.AddWithValue("IsDeleted", reader.GetBoolean(11));
            insert.Parameters.AddWithValue("DeletedAt", reader.IsDBNull(12) ? DBNull.Value : reader.GetDateTime(12));
            insert.Parameters.AddWithValue("DeletedBy", reader.IsDBNull(13) ? DBNull.Value : reader.GetGuid(13));

            inserted += await insert.ExecuteNonQueryAsync(cancellationToken);

            if (read % BatchSize == 0)
            {
                logger.LogInformation("Backfill progress: {Read} read, {Inserted} inserted", read, inserted);
            }
        }

        logger.LogInformation(
            "Collaboration backfill complete: {Read} source rows, {Inserted} inserted (duplicates skipped).",
            read, inserted);
        return true;
    }
}

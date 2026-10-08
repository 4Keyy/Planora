using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Todo.Infrastructure.Migrations;

public partial class AddAllFriendsSnapshot : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Preflight checks reject conflicting types and index definitions. IF NOT EXISTS also
        // supports the old model-created bootstrap and the already-installed additive fields.
        migrationBuilder.Sql("""
            ALTER TABLE todo."TodoItems" ALTER COLUMN "Title" TYPE character varying(1500);
            ALTER TABLE todo."TodoItems" ADD COLUMN IF NOT EXISTS "AllFriendsSnapshotAt" timestamp with time zone;
            ALTER TABLE todo."TodoItems" ADD COLUMN IF NOT EXISTS "CreatedByUserId" uuid;
            ALTER TABLE todo."TodoItems" ADD COLUMN IF NOT EXISTS "DueDateStart" timestamp with time zone;
            CREATE INDEX IF NOT EXISTS ix_todo_items_all_friends_snapshot_roots
                ON todo."TodoItems" ("IsPublic","AllFriendsSnapshotAt","ParentTodoId","Id");
            CREATE INDEX IF NOT EXISTS ix_todo_items_isdeleted_deletedat
                ON todo."TodoItems" ("IsDeleted","DeletedAt");
            CREATE INDEX IF NOT EXISTS ix_todo_items_user_status_deleted_completed
                ON todo."TodoItems" ("UserId","Status","IsDeleted","CompletedAt");
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder) =>
        throw new NotSupportedException("Frozen All-friends audiences cannot be rolled back automatically: an older binary could grant later friends access. Restore a compatible backup or apply an explicit privacy-preserving rollback plan.");
}
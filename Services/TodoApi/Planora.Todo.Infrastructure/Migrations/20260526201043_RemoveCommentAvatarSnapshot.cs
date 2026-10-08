using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Todo.Infrastructure.Migrations
{
    /// <summary>
    /// Drops the AuthorAvatarUrl snapshot column on todo_item_comments. From PR-5 onwards
    /// the comment listing handler always batch-fetches avatars from Auth via gRPC and
    /// the result is cached in-memory (60 s TTL) — single source of truth.
    /// </summary>
    public partial class RemoveCommentAvatarSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AuthorAvatarUrl",
                schema: "todo",
                table: "todo_item_comments");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AuthorAvatarUrl",
                schema: "todo",
                table: "todo_item_comments",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);
        }
    }
}

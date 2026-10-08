using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Todo.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCommentAvatarUrl : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<uint>(
                name: "xmin",
                schema: "todo",
                table: "TodoItems",
                type: "xid",
                rowVersion: true,
                nullable: false,
                defaultValue: 0u);

            migrationBuilder.AddColumn<string>(
                name: "AuthorAvatarUrl",
                schema: "todo",
                table: "todo_item_comments",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "xmin",
                schema: "todo",
                table: "TodoItems");

            migrationBuilder.DropColumn(
                name: "AuthorAvatarUrl",
                schema: "todo",
                table: "todo_item_comments");
        }
    }
}

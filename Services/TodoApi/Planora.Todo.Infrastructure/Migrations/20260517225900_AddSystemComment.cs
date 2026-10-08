using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Todo.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSystemComment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsSystemComment",
                schema: "todo",
                table: "todo_item_comments",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsSystemComment",
                schema: "todo",
                table: "todo_item_comments");
        }
    }
}

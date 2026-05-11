using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Todo.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddViewerCompletion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "CompletedByViewer",
                schema: "todo",
                table: "user_todo_view_preferences",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "CompletedByViewerAt",
                schema: "todo",
                table: "user_todo_view_preferences",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompletedByViewer",
                schema: "todo",
                table: "user_todo_view_preferences");

            migrationBuilder.DropColumn(
                name: "CompletedByViewerAt",
                schema: "todo",
                table: "user_todo_view_preferences");
        }
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Todo.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSubtaskParentTodoId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ParentTodoId",
                schema: "todo",
                table: "TodoItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "ix_todo_items_parent_deleted_created",
                schema: "todo",
                table: "TodoItems",
                columns: new[] { "ParentTodoId", "IsDeleted", "CreatedAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_TodoItems_TodoItems_ParentTodoId",
                schema: "todo",
                table: "TodoItems",
                column: "ParentTodoId",
                principalSchema: "todo",
                principalTable: "TodoItems",
                principalColumn: "Id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TodoItems_TodoItems_ParentTodoId",
                schema: "todo",
                table: "TodoItems");

            migrationBuilder.DropIndex(
                name: "ix_todo_items_parent_deleted_created",
                schema: "todo",
                table: "TodoItems");

            migrationBuilder.DropColumn(
                name: "ParentTodoId",
                schema: "todo",
                table: "TodoItems");
        }
    }
}

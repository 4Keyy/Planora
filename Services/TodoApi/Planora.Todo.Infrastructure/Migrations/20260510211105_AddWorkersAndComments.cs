using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Todo.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddWorkersAndComments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.EnsureSchema(
                name: "todo");

            migrationBuilder.CreateTable(
                name: "TodoItems",
                schema: "todo",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false, defaultValue: "Todo"),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    CategoryId = table.Column<Guid>(type: "uuid", nullable: true),
                    DueDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ExpectedDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ActualDate = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Priority = table.Column<int>(type: "integer", nullable: false, defaultValue: 3),
                    IsPublic = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    Hidden = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    CompletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RequiredWorkers = table.Column<int>(type: "integer", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TodoItems", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "user_todo_view_preferences",
                schema: "todo",
                columns: table => new
                {
                    ViewerId = table.Column<Guid>(type: "uuid", nullable: false),
                    TodoItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    HiddenByViewer = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    ViewerCategoryId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_user_todo_view_preferences", x => new { x.ViewerId, x.TodoItemId });
                });

            migrationBuilder.CreateTable(
                name: "todo_item_comments",
                schema: "todo",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TodoItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorId = table.Column<Guid>(type: "uuid", nullable: false),
                    AuthorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Content = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                    DeletedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    DeletedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_todo_item_comments", x => x.Id);
                    table.ForeignKey(
                        name: "FK_todo_item_comments_TodoItems_TodoItemId",
                        column: x => x.TodoItemId,
                        principalSchema: "todo",
                        principalTable: "TodoItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "todo_item_shares",
                schema: "todo",
                columns: table => new
                {
                    TodoItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    SharedWithUserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_todo_item_shares", x => new { x.TodoItemId, x.SharedWithUserId });
                    table.ForeignKey(
                        name: "FK_todo_item_shares_TodoItems_TodoItemId",
                        column: x => x.TodoItemId,
                        principalSchema: "todo",
                        principalTable: "TodoItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "todo_item_workers",
                schema: "todo",
                columns: table => new
                {
                    TodoItemId = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    JoinedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "now()")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_todo_item_workers", x => new { x.TodoItemId, x.UserId });
                    table.ForeignKey(
                        name: "FK_todo_item_workers_TodoItems_TodoItemId",
                        column: x => x.TodoItemId,
                        principalSchema: "todo",
                        principalTable: "TodoItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "todo_tags",
                schema: "todo",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    TodoItemId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_todo_tags", x => x.Id);
                    table.ForeignKey(
                        name: "FK_todo_tags_TodoItems_TodoItemId",
                        column: x => x.TodoItemId,
                        principalSchema: "todo",
                        principalTable: "TodoItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_todo_item_comments_TodoItemId_CreatedAt",
                schema: "todo",
                table: "todo_item_comments",
                columns: new[] { "TodoItemId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_todo_item_shares_SharedWithUserId",
                schema: "todo",
                table: "todo_item_shares",
                column: "SharedWithUserId");

            migrationBuilder.CreateIndex(
                name: "IX_todo_item_workers_TodoItemId",
                schema: "todo",
                table: "todo_item_workers",
                column: "TodoItemId");

            migrationBuilder.CreateIndex(
                name: "IX_todo_item_workers_UserId",
                schema: "todo",
                table: "todo_item_workers",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_todo_tags_TodoItemId",
                schema: "todo",
                table: "todo_tags",
                column: "TodoItemId");

            migrationBuilder.CreateIndex(
                name: "ix_todo_items_user_status_deleted_created",
                schema: "todo",
                table: "TodoItems",
                columns: new[] { "UserId", "Status", "IsDeleted", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TodoItems_CategoryId",
                schema: "todo",
                table: "TodoItems",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_TodoItems_CreatedAt",
                schema: "todo",
                table: "TodoItems",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_TodoItems_UserId",
                schema: "todo",
                table: "TodoItems",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_TodoItems_UserId_IsDeleted",
                schema: "todo",
                table: "TodoItems",
                columns: new[] { "UserId", "IsDeleted" });

            migrationBuilder.CreateIndex(
                name: "IX_TodoItems_UserId_Status",
                schema: "todo",
                table: "TodoItems",
                columns: new[] { "UserId", "Status" });

            migrationBuilder.CreateIndex(
                name: "IX_user_todo_view_preferences_TodoItemId_ViewerId",
                schema: "todo",
                table: "user_todo_view_preferences",
                columns: new[] { "TodoItemId", "ViewerId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "todo_item_comments",
                schema: "todo");

            migrationBuilder.DropTable(
                name: "todo_item_shares",
                schema: "todo");

            migrationBuilder.DropTable(
                name: "todo_item_workers",
                schema: "todo");

            migrationBuilder.DropTable(
                name: "todo_tags",
                schema: "todo");

            migrationBuilder.DropTable(
                name: "user_todo_view_preferences",
                schema: "todo");

            migrationBuilder.DropTable(
                name: "TodoItems",
                schema: "todo");
        }
    }
}

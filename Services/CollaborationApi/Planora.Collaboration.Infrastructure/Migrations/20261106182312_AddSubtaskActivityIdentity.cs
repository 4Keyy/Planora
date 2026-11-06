using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Collaboration.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddSubtaskActivityIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "SourceSubtaskId",
                schema: "collaboration",
                table: "comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_comments_TaskId_SourceSubtaskId",
                schema: "collaboration",
                table: "comments",
                columns: new[] { "TaskId", "SourceSubtaskId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_comments_TaskId_SourceSubtaskId",
                schema: "collaboration",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "SourceSubtaskId",
                schema: "collaboration",
                table: "comments");
        }
    }
}

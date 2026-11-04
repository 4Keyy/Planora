using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Collaboration.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddReplyReferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "ReplyToAuthorId",
                schema: "collaboration",
                table: "comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReplyToAuthorName",
                schema: "collaboration",
                table: "comments",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "ReplyToDeleted",
                schema: "collaboration",
                table: "comments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<Guid>(
                name: "ReplyToId",
                schema: "collaboration",
                table: "comments",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReplyToPreview",
                schema: "collaboration",
                table: "comments",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ReplyToType",
                schema: "collaboration",
                table: "comments",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_comments_TaskId_ReplyToId",
                schema: "collaboration",
                table: "comments",
                columns: new[] { "TaskId", "ReplyToId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_comments_TaskId_ReplyToId",
                schema: "collaboration",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "ReplyToAuthorId",
                schema: "collaboration",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "ReplyToAuthorName",
                schema: "collaboration",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "ReplyToDeleted",
                schema: "collaboration",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "ReplyToId",
                schema: "collaboration",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "ReplyToPreview",
                schema: "collaboration",
                table: "comments");

            migrationBuilder.DropColumn(
                name: "ReplyToType",
                schema: "collaboration",
                table: "comments");
        }
    }
}

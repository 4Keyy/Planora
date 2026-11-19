using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Collaboration.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddBranchDeletionMarkers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "branch_deletions",
                schema: "collaboration",
                columns: table => new
                {
                    TaskId = table.Column<Guid>(type: "uuid", nullable: false),
                    SubtaskId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_branch_deletions", x => new { x.TaskId, x.SubtaskId });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "branch_deletions",
                schema: "collaboration");
        }
    }
}

using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Planora.Realtime.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddNotificationDeletionScopes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NotificationDeletions",
                columns: table => new
                {
                    Scope = table.Column<int>(type: "integer", nullable: false),
                    ScopeId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NotificationDeletions", x => new { x.Scope, x.ScopeId });
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NotificationDeletions");
        }
    }
}

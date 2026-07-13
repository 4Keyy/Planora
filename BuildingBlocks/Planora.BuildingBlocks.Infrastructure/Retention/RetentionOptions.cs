namespace Planora.BuildingBlocks.Infrastructure.Retention
{
    /// <summary>
    /// Strongly-typed configuration for the data-retention / hard-purge subsystem, bound from the
    /// <c>Retention</c> configuration section (env vars <c>Retention__*</c>). Every window is expressed
    /// in whole days; every vector has its own enable flag so operators can roll policies out one at a
    /// time. The defaults are deliberately conservative: the whole subsystem ships <b>disabled</b> and,
    /// once enabled, runs in <see cref="DryRun"/> mode until an operator flips it off after watching the
    /// "would delete N" logs on production.
    /// </summary>
    public sealed class RetentionOptions
    {
        public const string SectionName = "Retention";

        // ── Global switches ────────────────────────────────────────────────────────────────────
        /// <summary>Master kill-switch. When false the <c>RetentionBackgroundService</c> never runs a pass.</summary>
        public bool Enabled { get; set; } = false;

        /// <summary>When true every policy counts and logs but deletes nothing. Safe on-prod rehearsal.</summary>
        public bool DryRun { get; set; } = true;

        /// <summary>UTC hour of day (0–23) the daily pass fires. Pinned to an off-peak window.</summary>
        public int RunAtHourUtc { get; set; } = 3;

        /// <summary>Max rows a single policy deletes per batch statement (WAL / lock-duration hygiene).</summary>
        public int BatchSize { get; set; } = 1000;

        /// <summary>
        /// Tripwire: if a policy finds more than this many eligible rows in one pass it aborts without
        /// deleting and raises an alert metric — defends against a bug that mass-marks rows deletable.
        /// </summary>
        public int MaxDeletionsPerRun { get; set; } = 50_000;

        /// <summary>
        /// Run a catch-up pass shortly after startup (in addition to the daily schedule), so data that is
        /// already past its window is cleaned on <b>every launch</b> rather than waiting for the next
        /// <see cref="RunAtHourUtc"/>.
        /// </summary>
        public bool RunOnStartup { get; set; } = true;

        /// <summary>Delay before the startup catch-up pass, giving the database/broker time to come up.</summary>
        public int StartupDelaySeconds { get; set; } = 60;

        // ── Retention windows (days) ───────────────────────────────────────────────────────────
        /// <summary>V1: grace between soft-delete (<c>DeletedAt</c>) and physical purge.</summary>
        public int SoftDeleteGraceDays { get; set; } = 7;

        /// <summary>V2: days a task may sit completed before it is auto-deleted.</summary>
        public int CompletedTaskDays { get; set; } = 30;

        /// <summary>V3: days a read notification survives after <c>ReadAtUtc</c>.</summary>
        public int ReadNotificationDays { get; set; } = 3;

        /// <summary>V6: days an unread notification survives after <c>OccurredOnUtc</c>.</summary>
        public int UnreadNotificationDays { get; set; } = 90;

        /// <summary>V7: days a delivery record survives after <c>DeliveredAtUtc</c>.</summary>
        public int NotificationDeliveryDays { get; set; } = 30;

        /// <summary>V4: days a processed/dead-lettered outbox message survives after <c>ProcessedOnUtc</c>.</summary>
        public int OutboxProcessedDays { get; set; } = 7;

        /// <summary>V5: days a processed inbox (idempotency) message survives after <c>ProcessedOnUtc</c>.</summary>
        public int InboxProcessedDays { get; set; } = 7;

        /// <summary>V8: grace past a refresh token's <c>ExpiresAt</c> before it is purged.</summary>
        public int ExpiredRefreshTokenDays { get; set; } = 30;

        /// <summary>V9: login-history retention (security forensics — kept long).</summary>
        public int LoginHistoryDays { get; set; } = 180;

        /// <summary>V10: audit-log retention (security forensics — kept long).</summary>
        public int AuditLogDays { get; set; } = 365;

        /// <summary>V11: age (by last transition) at which terminal friendship rows are purged.</summary>
        public int FriendshipTerminalDays { get; set; } = 90;

        /// <summary>V12: age (by <c>UsedAt</c>) at which spent recovery codes are purged.</summary>
        public int RecoveryCodeUsedDays { get; set; } = 30;

        /// <summary>V13: age (by <c>CreatedAt</c>) at which messages are purged (opt-in — user content).</summary>
        public int MessageDays { get; set; } = 365;

        // ── Per-vector enable flags ────────────────────────────────────────────────────────────
        public bool PurgeSoftDeleted { get; set; } = true;
        public bool PurgeCompletedTasks { get; set; } = true;
        public bool PurgeReadNotifications { get; set; } = true;
        public bool PurgeUnreadNotifications { get; set; } = true;
        public bool PurgeNotificationDeliveries { get; set; } = true;
        public bool PurgeOutboxInbox { get; set; } = true;
        public bool PurgeExpiredRefreshTokens { get; set; } = true;

        // Spent (already-used) recovery codes are safe to reap — enabled by default.
        public bool PurgeUsedRecoveryCodes { get; set; } = true;

        /// <summary>
        /// Physically purge soft-deleted user accounts (and all their Auth-owned dependent rows) after
        /// <see cref="SoftDeleteGraceDays"/>. Honours the "soft-deleted ⇒ really deleted after the grace
        /// window" rule for accounts too. On by default, but — like the whole subsystem — gated behind the
        /// master switch and dry-run, so nothing is erased until an operator deliberately enables it. Set
        /// false where legal/GDPR policy requires keeping deleted-account records.
        /// </summary>
        public bool PurgeDeletedUsers { get; set; } = true;

        // Security-forensics vectors ship OFF — enabling them is a compliance decision.
        public bool PurgeLoginHistory { get; set; } = false;
        public bool PurgeAuditLogs { get; set; } = false;

        // Touch user-meaningful history — ship OFF, enabling is a product decision.
        public bool PurgeFriendships { get; set; } = false;
        public bool PurgeMessages { get; set; } = false;
    }
}

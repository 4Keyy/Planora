-- Reviewed local Production-config reconciliation; no row deletion or history stamping.
-- Target: planora_auth_db; rehearsal: planora_local_rehearsal_auth_20261106.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
DO $target$
BEGIN
    IF current_database() NOT IN ('planora_auth_db', 'planora_local_rehearsal_auth_20261106') THEN
        RAISE EXCEPTION 'Unexpected database; reconciliation stopped';
    END IF;
END
$target$;


CREATE TABLE IF NOT EXISTS public."UserRecoveryCodes" (
    "Id" uuid NOT NULL,
    "UserId" uuid NOT NULL,
    "CodeHash" character varying(500) NOT NULL,
    "IsUsed" boolean NOT NULL,
    "UsedAt" timestamp with time zone,
    "CreatedAt" timestamp with time zone NOT NULL,
    "CreatedBy" uuid,
    "UpdatedAt" timestamp with time zone,
    "UpdatedBy" uuid,
    "IsDeleted" boolean NOT NULL,
    "DeletedAt" timestamp with time zone,
    "DeletedBy" uuid,
    CONSTRAINT "PK_UserRecoveryCodes" PRIMARY KEY ("Id")
);

ALTER TABLE public."Users" ALTER COLUMN "TwoFactorSecret" TYPE character varying(1024);

CREATE INDEX IF NOT EXISTS ix_outbox_messages_active ON public."OutboxMessages" ("Status", "NextRetryUtc", "OccurredOnUtc") WHERE "Status" IN ('Pending', 'Failed');

CREATE INDEX IF NOT EXISTS "IX_UserRecoveryCodes_IsDeleted" ON public."UserRecoveryCodes" ("IsDeleted");

CREATE INDEX IF NOT EXISTS "IX_UserRecoveryCodes_UserId" ON public."UserRecoveryCodes" ("UserId");

CREATE INDEX IF NOT EXISTS "IX_UserRecoveryCodes_UserId_IsUsed" ON public."UserRecoveryCodes" ("UserId", "IsUsed");

COMMIT;

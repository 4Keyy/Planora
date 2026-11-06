-- Reviewed local Production-config reconciliation; no row deletion or history stamping.
-- Target: planora_category; rehearsal: planora_local_rehearsal_category_20261106.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
DO $target$
BEGIN
    IF current_database() NOT IN ('planora_category', 'planora_local_rehearsal_category_20261106') THEN
        RAISE EXCEPTION 'Unexpected database; reconciliation stopped';
    END IF;
END
$target$;


CREATE INDEX IF NOT EXISTS ix_categories_isdeleted_deletedat ON public."Categories" ("IsDeleted", "DeletedAt");

CREATE INDEX IF NOT EXISTS ix_outbox_messages_active ON public."OutboxMessages" ("Status", "NextRetryUtc", "OccurredOnUtc") WHERE "Status" IN ('Pending', 'Failed');

COMMIT;

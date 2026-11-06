-- Reviewed local Production-config reconciliation; no row deletion or history stamping.
-- Target: planora_collaboration; rehearsal: planora_local_rehearsal_collaboration_20261106.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
DO $target$
BEGIN
    IF current_database() NOT IN ('planora_collaboration', 'planora_local_rehearsal_collaboration_20261106') THEN
        RAISE EXCEPTION 'Unexpected database; reconciliation stopped';
    END IF;
END
$target$;


CREATE INDEX IF NOT EXISTS ix_comments_isdeleted_deletedat ON collaboration.comments ("IsDeleted", "DeletedAt");

COMMIT;

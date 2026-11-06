-- Reviewed local Production-config reconciliation; no row deletion or history stamping.
-- Target: planora_messaging; rehearsal: planora_local_rehearsal_messaging_20261106.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SET LOCAL search_path = pg_catalog, public;
DO $target$
BEGIN
    IF current_database() NOT IN ('planora_messaging', 'planora_local_rehearsal_messaging_20261106') THEN
        RAISE EXCEPTION 'Unexpected database; reconciliation stopped';
    END IF;
END
$target$;


LOCK TABLE public."OutboxMessages" IN ACCESS EXCLUSIVE MODE;
DO $validate$
BEGIN
    IF EXISTS (SELECT 1 FROM public."OutboxMessages"
               WHERE char_length("Type") > 255 OR char_length("Error") > 2000) THEN
        RAISE EXCEPTION 'Existing outbox value exceeds reviewed length; no truncation is permitted';
    END IF;
    IF (SELECT data_type FROM information_schema.columns
        WHERE table_schema='public' AND table_name='OutboxMessages' AND column_name='Status') = 'integer' THEN
        IF EXISTS (SELECT 1 FROM public."OutboxMessages" WHERE "Status" NOT IN (0,1,2,3,4)) THEN
            RAISE EXCEPTION 'Unknown integer outbox status; conversion stopped';
        END IF;
        ALTER TABLE public."OutboxMessages" ALTER COLUMN "Status" TYPE text USING
            CASE "Status" WHEN 0 THEN 'Pending' WHEN 1 THEN 'Processing' WHEN 2 THEN 'Processed'
                          WHEN 3 THEN 'Failed' WHEN 4 THEN 'DeadLettered' END;
    ELSIF (SELECT data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name='OutboxMessages' AND column_name='Status') = 'text' THEN
        IF EXISTS (SELECT 1 FROM public."OutboxMessages"
                   WHERE "Status" NOT IN ('Pending','Processing','Processed','Failed','DeadLettered')) THEN
            RAISE EXCEPTION 'Unknown text outbox status; reconciliation stopped';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unexpected outbox status storage type';
    END IF;
END
$validate$;
ALTER TABLE public."OutboxMessages" ALTER COLUMN "Type" TYPE character varying(255);
ALTER TABLE public."OutboxMessages" ALTER COLUMN "Error" TYPE character varying(2000);
ALTER TABLE public."OutboxMessages" ALTER COLUMN "RetryCount" SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_outbox_messages_active ON public."OutboxMessages" ("Status", "NextRetryUtc", "OccurredOnUtc") WHERE "Status" IN ('Pending', 'Failed');

CREATE INDEX IF NOT EXISTS "IX_OutboxMessages_ProcessedOnUtc" ON public."OutboxMessages" ("ProcessedOnUtc");

CREATE INDEX IF NOT EXISTS "IX_OutboxMessages_Status_OccurredOnUtc" ON public."OutboxMessages" ("Status", "OccurredOnUtc");

COMMIT;

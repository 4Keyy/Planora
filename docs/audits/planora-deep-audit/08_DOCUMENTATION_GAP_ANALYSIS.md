# Документация и DX

Последний commit удалил исторические working notes и ввёл Git-listed parser/lint. Baseline51 docs/918 links/0 broken подтверждены; это проверка ссылок, не истинности всех текстов. Нельзя возвращать старые аудиты как актуальные контракты.

| Тема / canonical source | Gap | Действие T15 |
| --- | --- | --- |
| docs/INVARIANTS.md | DIST-010: Pending backoff описан как сломанный, код уже проверяет NextRetryUtc | Исправить описание, сохранить real single-processor limitation |
| docs/deployment.md | OPS-009: Todo missing initial/Realtime no init устарели | Сверить first migration и startup helpers/tests; не сохранять ложный blocker |
| deploy/fly/migrator.fly.toml | Reserved comment говорит Dockerfile отсутствует, он существует | Обновить комментарий через T14 ownership; не делать из этого production-ready claim |
| docs/API.md/auth-security.md/security-idor-coverage.md | Будущие auth/revoke/cursor changes | После implementation обновить role/status/event matrix и limits |
| docs/database.md | Model-created vs migrations/adoption | Описать supported prior schemas,expand/backfill/contract,restore |
| docs/caching.md/backup-recovery.md | Cache и key ring имеют разный lifecycle | Зафиксировать решение T09/T02/T14 и decryption drill |
| docs/testing.md/TESTING.md | Не все green checks локально воспроизводились | Сохранить cwd,SDK,env,skips,retries,isolated DB требования |
| docs/slo.md/observability.md/perf/README.md | Targets provisional,empty workload | Actual measurement только после T16,не выдумывать dashboards |
| docs/features.md/frontend.md/design-system.md | UX invariants и новые lifecycle guards | Описывать behavior без редизайна; page-specific differences сохраняются |

README — setup overview; codebase-map — navigation; architecture — runtime ownership; topic guides остаются источниками истины. Аудит — evidence snapshot и execution plan. T15 получает doc deltas каждого пакета, обновляет только фактически внедрённое; документы к будущему deployment помечает proposal/NOT_VERIFIED.

Existing `tools/docs/check.mjs` проверяет case/paths/anchors и поддерживает include-untracked; `lint.mjs` использует ту же Git inventory. T15 проверяет команды отдельно: parser не исполняет shell examples. Никакой новой docs toolchain не требуется.

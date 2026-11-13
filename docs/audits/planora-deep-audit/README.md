# Planora: forensic audit и план исполнения

Этот README описывает исторический baseline 2026-11-02. Текущее исполнение —
[PROGRESS.json](results/PROGRESS.json), результаты пакетов и
[синхронизация 2026-11-06](results/REPOSITORY_SYNC_20261106.md).
Первоначальный план и его ограничения ниже не являются текущим PASS всего проекта.

Baseline `dc6b1781a24d43d967c418de30acda10fcafb8f9`, 2026-11-02. Создано16 самостоятельных пакетов и машиночитаемый план. Код приложения не менялся. Начать новую сессию: передать [START_NEW_SESSION.md](START_NEW_SESSION.md).

**Граница полноты:** инвентаризированы1558 tracked файлов; READ/REVIEWED230(14.76%), включая частичные проходы с ranges.1321 файл требует продолжения,6 assets исключены,1 чужой dirty file blocked. Это глубокий адресный аудит критических потоков с полным инвентарём, а не законченный построчный аудит всей системы.80 пачек продолжения являются обязательной частью будущей работы.

34 findings:31 CONFIRMED,3 LIKELY;16 P1,16 P2,2 P3,0 выявленных P0. CONFIRMED различает статическую ошибку, выполненный in-memory experiment, scanner result и факт настройки. Важные области: erasure fan-out/Rabbit DLQ,transaction boundaries,session stale responses,live subscription revoke,CI/deployment gates.16 P1 не означают16 доказанных production exploits.

## Материалы

- [Baseline и доступ](00_BASELINE_AND_SCOPE.md), [архитектура](01_ARCHITECTURE_AND_DATA_FLOW.md).
- [Per-file coverage](02_FILE_AUDIT_INDEX.md), [CSV](02_FILE_AUDIT_INDEX.csv), [continuation batches](evidence/continuation-batches.json).
- [Findings](03_FINDINGS_REGISTER.md), [JSON](03_FINDINGS.json), [threat model](04_SECURITY_THREAT_MODEL.md).
- [Tests](05_TEST_TRACEABILITY_MATRIX.md), [CI parity](06_CI_CD_PARITY.md), [performance](07_PERFORMANCE_BASELINE.md), [docs gaps](08_DOCUMENTATION_GAP_ANALYSIS.md).
- [Dependencies/ownership](09_DEPENDENCIES_AND_CRITICAL_PATH.md), [acceptance](10_ACCEPTANCE_GATES.md), [playbook](11_EXECUTION_PLAYBOOK.md).
- [Executor contract](EXECUTOR_CONTRACT.md), [TASKS](TASKS.json), [red-team review](RED_TEAM_REVIEW.md), [ограничения](UNVERIFIED_AND_BLOCKERS.md).

## Порядок

Последовательно:01→12→05→08→09→02→03→04→06→07→10→11→13→14→15→16. Ограниченный параллелизм — только после shared contract freeze и проверки file ownership. T11 ждёт T06 и T10, чтобы принять серверный cursor/reconciliation contract. Каждый следующий пакет читает results предшественников; статус planned не означает реализованное исправление.

## Что реально запускалось

Frontend lint/typecheck PASS; backend UnitTests1207 PASS/31 SKIP (Postgres filtered); focused frontend53 PASS; docs/scanner tooling21 PASS; E2E tooling8 PASS при правильном cwd. Npm production audit0; full graph16 moderate affected entries. Remote CI baseline green, E2E shard6 red,scheduled gitleaks66 matches. Локальный browser/full stack/coverage/build/benchmark/restore не выполнены. Полные условия и ссылки в baseline.

В этой сессии только planning artifacts. Локальный commit документов допустим; push запрещён мастер-промптом. Для новой реализации нужен переданный владельцем стартовый промпт; remote settings/deploy/migrations/branch cleanup остаются отдельными действиями. Не удалять evidence ради внешнего вида репозитория.

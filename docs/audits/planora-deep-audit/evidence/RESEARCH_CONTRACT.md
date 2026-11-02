# Контракт исследования и checkpoint

Дата пользователя: 2026-11-02, Europe/Moscow. Baseline: `dc6b1781a24d43d967c418de30acda10fcafb8f9`, `main`, `https://github.com/4Keyy/Planora`.

Мастер-промпт целиком получен из пользовательского вложения; одноимённого файла в checkout при старте не было. Копия сохранена в родительской директории. Graphify wiki/report отсутствуют. Исходный dirty path: `frontend/next-env.d.ts`; чужая работа, не изменять.

Разрешены чтение исходников и истории, безопасные локальные проверки, создание документов/реестров/prompt-файлов только в `docs/audits/planora-deep-audit/`. Нельзя менять приложение, тесты, CI, infra, применять миграции, обращаться к production, устанавливать зависимости, выполнять push/merge/branch operations. Не читать .env/auth/OAuth/credentials. Локальный commit только собственных документов после review; push запрещён текущей задачей.

## Формат материалов независимых исследователей

- `evidence/<area>-review.md`: трассы кода с точными file:line, тесты, история, положительные контроли, ограничения; не подменять источник прежним аудитом.
- `evidence/<area>-files.json`: массив объектов `path`, `status` (READ/REVIEWED/NEEDS_DEEP_REVIEW/EXCLUDED_WITH_REASON/BLOCKED), `pass`, `lines`, `note`. REVIEWED только после содержательного чтения критических связей, READ после полного чтения; выборочные строки честно обозначить в lines.
- `evidence/<area>-findings.json`: массив объектов `id`, `title`, `confidence` (CONFIRMED/LIKELY/HYPOTHESIS/NOT_VERIFIED), `priority` (P0..P3), `severity`, `likelihood`, `evidence` (массив `{path,lines,symbol,observation}`), `trigger`, `impact`, `root_cause`, `fix`, `alternatives`, `tests`, `acceptance`, `dependencies`, `package`, `limitations`.
- Каждый исполняемый пакет читает `../EXECUTOR_CONTRACT.md` по смыслу: файл расположен рядом с PROMPT, поэтому фактическая Markdown-ссылка `[EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md)`.
- PROMPT содержит все 12 полей §14 мастер-промпта, конкретные факты, реальные пути, собственный runbook, ownership, red/green, rollback, отчёт, трудоёмкость. До сборки общего TASKS.json используйте ID задачи `Txx` для соответствующего PROMPT_xx; finding IDs: BE-xxx, DIST-xxx, FE-xxx, OPS-xxx.
- Проверки фиксируются командой, cwd, exit code, кратким результатом и границами. Не запускать чужие сервисы/долгие нагрузки. Не объявлять code review динамической проверкой.
- Агенты не одни в checkout: не откатывать и не редактировать файлы других исследователей, не коммитить самостоятельно.

## Распределение

- backend: Auth, Todo, Category, Collaboration, EF/schema/ownership; PROMPT 02, 03, 04, 08.
- distributed: BuildingBlocks, Messaging, Realtime, Gateway, GrpcContracts, Redis; PROMPT 01, 05, 06, 07, 09.
- frontend: frontend routes/components/hooks/stores, UX/auth/realtime/search, frontend tests; PROMPT 10, 11, 13.
- root: inventory, Git 40+ commits, GitHub, CI/CD, deploy/tooling, docs, security synthesis, remaining prompts 12,14,15,16, aggregation and validation.

Final aggregation must distinguish complete inventory from partial semantic review. Every remaining file gets a continuation batch; no invented all-code audit claim.

# T11 — Страницы, поиск и визуальная регрессия без редизайна

## Цель и обязательный договор

Ты frontend/UX engineer. Цель — доказать неизменность продукта после T10 и исправлять только воспроизведённые ошибки страниц/навигации/доступности. Прочитай [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md), [frontend evidence](evidence/frontend-review.md), [матрицу](05_TEST_TRACEABILITY_MATRIX.md) и результаты T10. Минимальный автономный договор: не менять дизайн, тексты, shortcuts, sort/privacy semantics, motion timing или page-specific task actions; не понижать тестовые пороги; сохранить чужую работу; сначала evidence и RED; не выполнять push/merge/deploy без разрешения.

Baseline: main `dc6b1781a24d43d967c418de30acda10fcafb8f9`, `https://github.com/4Keyy/Planora`. Проверить HEAD и каждый символ; при drift переоценить конкретный пункт. Аудит не содержит новых screenshot/performance measurements. Старые комментарии о CLS/15KB/486 errors не использовать как свежие результаты.

## Inputs / outputs / зависимости / ownership

- Входы: T10 auth epoch contract; T03/T04 согласованные task/category semantics; T06/T07 API/realtime contracts. T11 визуальная фиксация baseline может начаться до их fixes, финальная приёмка — после.
- Owner scope: `frontend/src/app/(app)/**`, `components/command-palette/**`, `components/ui/toast.tsx`, `components/notifications/**`, `components/todos/edit-todo-modal/**` и адресные page/component/E2E tests. T10 единолично меняет auth/cache/realtime core; shared `use-task-actions.ts` менять только если воспроизведён дефект и согласована передача ownership.
- `profile/page.tsx` и `auth/verify-email/page.tsx` имеют узкие refresh call-site fixes у T10: эти два файла брать только после handoff T10, не редактировать параллельно.
- Outputs: fixtures/screenshots до/после с указанием viewport/DPR/browser, navigation race tests, список разрешённых visual exceptions (по умолчанию пуст), documented risk dispositions. Полный frontend redesign не output.

## Карта и инварианты

13 реальных pages: `/`; auth login/register/forgot-password/forgot-password/sent/reset-password/verify-email; `/dashboard`, `/tasks`, `/tasks/completed`, `/categories`, `/profile`, `/branch/[id]`. Список исходников в frontend-files.json.

Root `layout.tsx:159-183` держит глобальные notices/search/realtime; `(app)/layout.tsx` сохраняет AppShell. `command-palette/index.tsx:129-147,184-209,379-442` уже prefetch-ит snapshot на hover/focus, использует transition и guards. Не добавлять произвольный debounce/fetch-on-open как «оптимизацию». 100 active +30 completed — текущий продуктовый scope поиска. Hidden tasks deliberately читаются с revealHidden и остаются blurred до жеста; не удалять эту возможность по общему совету о privacy, сверить ADR/серверный доступ.

`useTaskActions` используется разными страницами с разными options/callbacks. Branch `page.tsx:52` выбирает completion `for-viewer`, `describe:true`; callback duplicate открывает новый branch. Сохранить это, а также owner-completed refusal и viewer-category semantics. Старые FE-24 refactors не означают, что все UI действия должны стать одинаковыми.

`ui/toast.tsx:93-116` уже передаёт фокус после dismiss и снимает stale pause; `store/toast.ts` clocks/pause/readable duration — существующий договор. Исходная гипотеза «TTL сломан» требует нового reproduction, а не отмены fix `08f97cb`.

## План по ID

### T11.1 / FE-005 / P2 — branch response ownership

Confidence LIKELY: `branch/[id]/page.tsx:35-48` load не отменяет прежний response, но actual router remount при A→B не проверен. Сначала два доказательства:

1. В `src/test/app/branch-page.test.tsx` или `branch-page-edges.test.tsx` controlled params/mock fetch: A slow→B fast→A success; затем A fail после B success. Ожидается task B, не MissingTask.
2. Browser `/branch/A`→`/branch/B` на существующем Next production build, synthetic fixture; записать факт remount или reuse. Не выдавать rerender hook за доказательство router поведения.

Если воспроизводится — latest request epoch + AbortSignal, привязанные к todoId и session epoch; late response не setTodo/notFound/loading. `fetchTaskById` принадлежит T10, API signature изменение согласовать до edit. Ошибки 403/404/сеть должны сохранять существующие UX сообщения; не заменять все на success. Если router всегда remount и иных competing loads не найдено, закрыть FE-005 evidence как nonissue без исправления.

### T11.2 / P2 — gates для async fixes

Для dashboard/tasks/archive/categories/profile/branch проверить A→logout→B и slow request. `categories/page.tsx:72-98` получает list+counts и передаёт cache без captured owner; после T10 cache epoch этот handoff должен явно не присвоить старую категорию новому owner. Не считать текущий экран корректным только потому, что старый React setState после unmount игнорируется: root cache сохраняется отдельно.

Test matrix: owner/friend/stranger, private/public/shared/hidden, owner complete/viewer complete, expired task, failed save/undo/retry, page switch during pending action. Сопоставить с существующими `tasks-page-actions`, `dashboard-page`, `completed-page-actions`, `branch-page-edges`, `categories-page`, `profile-actions` tests. Не переписывать эти safety nets под новый код; добавить узкие race cases.

### T11.3 / P2 — search и notices measured baseline

Измерить keyboard Ctrl/Cmd+K и pointer button отдельно, cold/warm browser context, 0/100 active tasks, delayed categories/friends, unavailable API. Метрики: input/event→first visible dialog frame, first usable input, rows stable, long tasks, request count. Минимум 10 cold и 30 warm opens с одной фиксированной machine/browser build; median/p95 с сырыми trace timestamps. Порог отсутствия регрессии: не хуже baseline p95 более max(10%, 16ms); это будущий acceptance budget, не полученное измерение.

Не оптимизировать без measurement. Для stall сначала различить chunk load, sync sort/filter, render, backend RTT и intentional morph. `preparePalette` уже держит fresh snapshot 3s. Preserve allSettled partial availability, hidden reveal, recent per-user history и keyboard selection.

Notices: mouse hover pause→dismiss→remaining resume; keyboard focus→dismiss→next focus; swipe; overflow cap; undo timeout; tab hidden/reopen. Fake timers проверяют logic, real browser pointer/focus и animation regression обязательны. При фиксе только clocks/focus, прежние layout/colors/tokens/durations сохранить.

### T11.4 / P2 — accessibility / motion / responsive verification

Новые визуальные изменения разрешены только с screenshot/geometry evidence дефекта. Baseline viewport 390×844, 768×1024, 1440×900; DPR1 для сравнения + отдельный реальный touch profile. Normal motion и reduced motion; keyboard Tab/Shift+Tab/Escape/Enter/Space, IME/Cyrillic shortcuts, focus restore. Modals/popovers/editor/delete strip не должны менять pointer visuals ради keyboard focus.

Использовать существующие E2E `dialog-motion`, `motion-geometry`, `expanded-card-geometry`, `task-height-motion`, `compact-rail`, `notices-errors`, `tasks-page`. Root получил сведения о failed baseline E2E run `41368376503`, shard6 job `125033430746` (6 failed/3 passed, включая task-height geometry и ограниченный disposable auth bucket); перед запуском прочитать точное remote evidence из 06_CI_CD_PARITY. Не называть весь UI green и не смешивать environment 429 с geometry defect.

## Runbook

```powershell
Set-Location F:\Projects\Planora
git status --short
git rev-parse HEAD
Set-Location frontend
npm exec -- vitest run src/test/app/branch-page.test.tsx src/test/app/branch-page-edges.test.tsx src/test/app/categories-page.test.tsx src/test/app/dashboard-page.test.tsx src/test/app/tasks-page-actions.test.tsx src/test/app/completed-page-actions.test.tsx src/test/components/command-palette.test.tsx src/test/components/toaster.test.tsx --maxWorkers=2
npm run lint
npm run type-check
```

NOT_VERIFIED/environment-dependent commands — только disposable backend и свой frontend port; существующие E2E создают synthetic users и данные, их не запускать против production/чужой local DB:

```powershell
$env:E2E_API_URL = 'http://127.0.0.1:5132'
$env:E2E_FRONTEND_URL = 'http://127.0.0.1:3102'
npm run e2e -- --project=ui e2e/ui/task-height-motion.ui.spec.ts e2e/ui/notices-errors.ui.spec.ts e2e/ui/dialog-motion.ui.spec.ts
```

Порты — пример будущей изолированной среды, не утверждение, что она запущена. Side build `$env:NEXT_DIST_DIR='.next-audit-t11'` лишь в workspace без чужих generated declarations; не восстанавливать чужой next-env автоматически. Соответствие local/CI launcher согласует T14.

## Acceptance

- [ ] FE-005 воспроизведён/исправлен или закрыт доказательством отсутствия сценария.
- [ ] Все 13 routes имеют explicit pass/fail/not-run matrix; empty/loading/offline/error состояния не потеряны.
- [ ] No cross-account categories/tasks/avatar/notices после T10; API permissions не заменены UI gating.
- [ ] Before/after screenshots/geometry и список intentional exceptions; normal/reduced motion, pointer/keyboard проверены.
- [ ] Search measurements воспроизводимы, нет роста requests или p95 выше бюджета; нет недоказанной оптимизации.
- [ ] Failed baseline E2E классифицированы и повторены в эквивалентной среде; tests не skipped/softened ради green.
- [ ] Lint/typecheck/targeted tests/coverage ratchets проходят; docs T15 updated.

## Риски / rollback / размер / отчёт

Риски: race fix через remount может потерять autosave, selection и open-state; перестройка focus/DOM может изменить morph origin; уменьшение анимации ради метрик — регрессия продукта. Предпочти scoped guards. Миграций нет. Rollback — только собственный commit, restore прежних визуальных токенов; возвращение privacy дефекта требует stop-the-line и альтернативного fix.

Оценка 2–5 дней, контекст 30–50k. Разделение: branch/data race; search benchmark; notices/a11y/visual fixtures. Не параллелить два редактора одного command-palette или shared modal. Отчёт: SHA, exact pages/states/browser/viewports, screenshots, metrics/raw sampling protocol, commands/results, FE dispositions, changed paths, docs, unresolved CI blockers, commits/PR если разрешены.

## Поздний Realtime handoff — обязательное дополнение

Блокирующие predecessors по TASKS.json: T10 И T06. После `results/T06.md` внедрить его cursor/reconciliation contract с полным сохранением session guards T10. Владелец T11 получает временный file lock на frontend/src/lib/api.ts и frontend/src/store/notifications.ts исключительно для этого handoff; T10 уже завершён. Проверить timestamp ties, offline reconnect, duplicate ID/unread count и reset during reconciliation. Нельзя завершить T11 раньше server/client contract integration. Screens/profile refresh фрагменты переданы из T10 без параллельного overwrite.

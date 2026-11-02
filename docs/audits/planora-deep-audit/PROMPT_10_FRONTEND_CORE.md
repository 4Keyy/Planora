# T10 — Изоляция клиентской сессии и асинхронных ответов

## Роль, цель и автономный контракт

Ты frontend engineer, исправляющий подтверждённые ошибки lifecycle без изменения внешнего продукта. Прочитай целиком [EXECUTOR_CONTRACT.md](EXECUTOR_CONTRACT.md), [frontend evidence](evidence/frontend-review.md), [реестр](03_FINDINGS_REGISTER.md) и результаты зависимостей. Если передан только этот файл: сначала git status/HEAD, сохранить чужой diff; не менять дизайн, API, privacy/sort/motion, не ослаблять тесты; сначала воспроизводящий тест, затем минимальный fix; не объявлять green без exit/result. Не читать secrets. Новые ветки/PR/merge/deploy/push только при отдельной действующей авторизации.

Baseline: `https://github.com/4Keyy/Planora`, main, `dc6b1781a24d43d967c418de30acda10fcafb8f9`. Выполнение начинается с сравнения актуального HEAD; старые номера строк — указатели, а не слепой патч. Planning findings FE-001..005 отличаются от исторических FE-24 в коде. В момент аудита `frontend/next-env.d.ts` был чужим dirty-файлом.

## Preconditions / inputs / outputs / blocked_by

- Вход: текущие auth/notification contracts из T02/T06; это синхронизация поведения, backend changes не обязательны для локального RED. T01 даёт baseline shared contracts. Отдельного backend решения для epoch не нужно.
- Исполнение frontend fixes можно начать независимо от backend changes; интеграционная приёмка ждёт результатов T02/T06/T07. Не добавляй циклическую зависимость T06→T10→T06: T06 владеет сервером, T10 клиентом.
- Outputs: deferred regression tests, небольшой lifecycle patch, evidence с красным/зелёным результатом, актуализация `docs/frontend.md` и при необходимости `docs/auth-security.md` через T15.
- Owner scope: `frontend/src/store/auth.ts`, `lib/auth-public.ts`, `lib/api.ts`, `components/security-initializer.tsx`, `store/notifications.ts`, `lib/realtime/hooks.ts`, `lib/realtime/client.ts`, `hooks/use-categories.ts` и их тесты. T11 владеет pages/components UX; T13 общими test fixtures. Общие тестовые файлы не редактировать одновременно.
- Узкое исключение ownership pages: T10 также меняет только refresh continuation в `src/app/auth/verify-email/page.tsx:57-70` и `src/app/(app)/profile/page.tsx:775-815`; T11 начинает работу над этими файлами после завершения T10 и передачи diff. Layout/markup/тексты этих страниц остаются областью T11.

## Исследованная карта и работа по приоритету

### T10.1 / FE-001 / P1 — auth epoch

Доказательство: `auth.ts:243-257` очищает состояние и pending timer, `290-339` после await без проверки применяет refresh/clearAuth, `346-377` делает то же в scheduled callback. `api.ts:377-417` повторяет исходный запрос после shared refresh без проверки того, какая сессия его начала. Harness D-FE-1 выполняет реальный auth source: restore→clear→старый response возвращает `isAuthenticated=true`.

Порядок:

1. В существующих `src/test/store/auth.test.ts` и `src/test/lib/api-interceptors.test.ts` добавить controlled deferred promises, не реальные задержки/сеть. RED: restore/validate/scheduled/401 request начат в A; clearAuth; ответ A success и reject. Добавить A→B и A→logout→A.
2. Добавить монотонный `sessionEpoch` в auth boundary. Эпоха меняется при явном начале/окончании сессии (`setAuth`, `clearAuth`); обычный `applyRefresh` её не меняет. Не persist epoch и tokens. Публичная проверка текущего epoch допустима, новый state manager не нужен.
3. Каждая операция захватывает epoch до первого await. Перед любым auth mutation, redirect, retry, telemetry under account проверить epoch. Старый result должен завершить только свой Promise, без изменения новой сессии.
4. Shared `refreshRequest` в `auth-public.ts` не должен позволять новой сессии присоединиться к старому refresh. Привяжи inflight к epoch либо предоставь сброс по session boundary без циклического импорта. Сохрани Web Lock и CSRF retry.
5. Исходный 401 mutation не повторяется с credentials нового пользователя. Только same-session retries разрешены; cancellation/error сохраняет ожидаемый контракт caller. Не меняй все 401 на silent success.
6. Закрой все остальные прямые callers: `auth/verify-email/page.tsx:64` и `profile/page.tsx:798-799` тоже вызывают refresh→applyRefresh без epoch. Результат проверки email остаётся успешным даже если обновление токена стало stale; avatar upload success не должен перезаписать профиль новой сессии. Найди все callers через `rg -n 'applyRefresh|refreshAccessToken' src` и зафиксируй coverage matrix, не ограничиваясь store/interceptor.

Алгоритм, не готовый патч:

```text
captured = currentSessionEpoch()
result = await operationFor(captured)
if captured != currentSessionEpoch(): return staleOutcome
apply result / retry original request
```

`staleOutcome` должен быть согласован с существующим return type: для void restore — early return; для interceptor — rejected cancellation/исходная ошибка без logout новой сессии. Просто сравнивать userId нельзя: повторный вход тем же пользователем тоже новая сессия. AbortController не заменяет guard.

### T10.2 / FE-002 / P1 — notification ownership

`notifications.ts:123-143,209-210,252-253` записывает поздние ответы в singleton; `reset:274` только очищает values. D-FE-2: loadList→reset→resolve кладёт old-account item обратно. `hooks.ts:58-112` слушает только isAuthenticated и не проверяет `payload.userId` перед ingest/OS notification.

1. RED для каждого late continuation, включая error `listLoaded=true`, hydrate/read-summary и direct account switch.
2. Store привязать к auth epoch + userId; reset инвалидирует pending operations. Проверять владение до set и ingest, а не только на UI render.
3. Lifecycle зависеть от identity; очистка/новая hydrate при смене пользователя. OS notification отправлять только после валидного current-owner ingest. Не печатать title/message в diagnostics.
4. Одновременно проверь ordering: summary request начат, live event принят, старый summary пришёл. Если badge откатывается, добавь revision и coalesced reconciliation; не запускай бесконечный hydrate на каждый render.
5. Reconnect listener для notification summary проверить отдельно: существующий poll прекращается после isConnected; missed notifications должны восстанавливаться после reconnect даже без focus. Используй существующий `onResync`, не второй socket.

### T10.3 / FE-003 / P2 — симметрия room membership

`hooks.ts:186` откладывает join до start.then; cleanup `192-195` может отработать раньше. D-FE-3: поздний join после unmount. `client.ts:220-235` затем хранит refcount и `rejoinAll` возвращает ghost room при reconnect.

RED: deferred start; unmount; resolve; ожидается 0 joins. Затем A→B до resolve и два подписчика A + StrictMode mount/cleanup. Выбери минимальную симметричную регистрацию: active/session guard для continuation и cleanup именно своей регистрации; либо регистрация refcount до start с доказанной отсутствующей двойной wire join. В первую очередь сохранять контракт клиента. Серверные hub authorization и group revoke принадлежат T06.

### T10.4 / FE-004 / P2 — avatar hydration

`security-initializer.tsx:72-91`: /users/me response пишет `updateUser` текущему пользователю. RED A pending→logout/login B→A resolves; avatar B неизменён. Добавь captured identity/epoch + cleanup AbortController, зависимость userId; nonfatal 5xx и отсутствие лишнего GET на обычный token refresh сохранить.

### T10.5 / verification-only — категории

`use-categories.ts:79-97` проверяет userId для publish, но возвращает старое value; `126-159` принимает external cache под текущим userId, не исходным. Перед любым fix докажи controlled scenario A→logout→A и запрос A→switch B→старый getCachedCategories consumed. Сравни с уже корректным `use-friends.ts:18-75,125-130` generation pattern. Не объявляй неизмеренный риск новым confirmed defect. Если воспроизводится — тот же epoch contract, caller не получает чужие values и retries прекращаются после session change.

## Runbook

Предусловия: установленный locked frontend node_modules, Node/npm версии сверены с T14. Не выполнять npm install автоматически. Все команды ниже существуют в repository scripts; будущие RED-тесты сначала добавляются в названные существующие файлы.

```powershell
Set-Location F:\Projects\Planora
git status --short
git rev-parse HEAD
git diff dc6b1781a24d43d967c418de30acda10fcafb8f9 -- frontend/src/store/auth.ts frontend/src/store/notifications.ts frontend/src/lib/realtime/hooks.ts
Set-Location frontend
npm exec -- vitest run src/test/store/auth.test.ts src/test/lib/auth-public.test.ts src/test/lib/api-interceptors.test.ts src/test/store/notifications.test.ts src/test/lib/notifications-lifecycle.test.tsx src/test/lib/realtime-hooks.test.tsx src/test/lib/realtime-client.test.ts src/test/hooks/use-categories.test.tsx src/test/hooks/use-friends.test.tsx --maxWorkers=2
npm run lint
npm run type-check
npm run test:coverage
```

Порядок RED→минимальный fix→targeted GREEN→broader checks. Сохраняй command/cwd/exit/duration, coverage json-summary и concise assertions, без JWT/PII. Полный coverage может быть ресурсоёмким: выполнять изолированно, не параллельно с другой полной сборкой.

NOT_VERIFIED live gate: в disposable окружении с двумя synthetic accounts выполнить login→logout→login, delayed network, 429, reload, two tabs, reconnect. Не использовать рабочий backend владельца без проверки происхождения. Production build только в согласованном isolated checkout/side NEXT_DIST_DIR; не перезаписывать dirty next-env/tsconfig. T16 владеет этой общей проверкой.

## Acceptance / checklist

- [ ] Все три harness race представлены настоящими regression tests, до fix RED и после GREEN.
- [ ] Старый success **и** failure не меняет новую сессию; ни stale role, avatar, notification, OS notice, retry mutation.
- [ ] Normal refresh не сбрасывает пользовательский экран и не создаёт reconnect storm; current session notifications и typing работают.
- [ ] 429 preservation/Web Lock/CSRF/foreign 403 semantics прежние; tokens не persist.
- [ ] Room refcounts нулевые после последнего unmount, reconnect только текущих rooms.
- [ ] Existing focused tests, lint, typecheck и coverage ratchets проходят; ничего не исключено ради green.
- [ ] Нет смены visual tokens/layout/motion или публичных HTTP DTO.
- [ ] Изменённые docs согласованы T15; evidence содержит actual results и остающиеся NOT_VERIFIED.

## Риски, rollback, размер и отчёт

Главный риск — неправильно увеличивать epoch на каждом refresh и отменять действующую работу; второй — циклические imports auth↔api↔notification. Выделять максимум маленький session-generation primitive, без универсального middleware framework. Миграций нет. Rollback — отмена только собственных frontend commit после проверки ownership, при этом возврат privacy bug явно означает stop-the-line; нельзя тихо откатить security correction ради зелёного UI.

Оценка: 2–4 инженерных дня, контекст 35–55k токенов; не запускать всё одной моделью без checkpoints. Подпакеты T10.1→T10.2/T10.4; T10.3 отдельно, но `hooks.ts` один владелец. T10.5 только после доказательства.

Отчёт: baseline/current SHA, changed paths, FE IDs и RED/GREEN, commands+exit+duration, coverage, before/after requests/reconnect counts, docs, unresolved items, локальные commit IDs и PR только если разрешён. Не заявлять UI/live green по jsdom.

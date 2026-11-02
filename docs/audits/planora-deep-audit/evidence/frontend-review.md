# Frontend: forensic evidence и checkpoint

Baseline: `dc6b1781a24d43d967c418de30acda10fcafb8f9`, main; 2026-11-02 Europe/Moscow.
Независимый исследователь `/root/frontend_audit`. Прочитаны полностью протокол и мастер-промпт. Рабочий код/тесты/CI не изменялись. `frontend/next-env.d.ts` исходно dirty, не тронут.

## Охват и ограничения

Инвентаризированы все tracked frontend paths; содержательный проход концентрируется на auth, API, caches, realtime, notifications, search, page data-flow и существующих regression tests. `frontend-files.json` различает полный и выборочный проход; остальные файлы требуют следующего пакета, а не считаются прочитанными. Снимки UI, настоящий browser/SignalR/backend и screen reader в этом проходе не запускались. Производительность открытия поиска, Web Vitals и visual equivalence NOT_VERIFIED. Комментарии старых измерений в коде не являются свежим benchmark.

## Фактическая карта

- Root `src/app/layout.tsx:159-183` монтирует SecurityInitializer, RealtimeManager, CommandPalette и Toaster; `dynamic=force-dynamic:106` поддерживает per-request CSP. `src/proxy.ts:54-90` задаёт nonce CSP; `next.config.js:221-239` проксирует 9 префиксов, включая `/friendships` и realtime.
- `src/store/auth.ts:146-412`: Zustand, access JWT только in-memory; sessionStorage partialize `390-396` исключает raw tokens и isAuthenticated. `AuthGuard:13-24` ждёт hydration+restore и не рендерит защищённый контент до готовности.
- `auth-public.ts:18-36,101-129`: per-tab single-flight, origin Web Lock, bounded one retry после 429; fallback без Web Locks остаётся. `api.ts:206-249,329-445`: Authorization/CSRF/time-zone/traceparent, foreground 401 refresh, no refresh for background silent polls, CSRF-only retry 403.
- `use-friends.ts:18-75,125-130`: owner + generation, дедупликация страниц и inflight, ограничение 50×100; `friend-names.ts:31-38` проверяет identity после await; `use-author-names.ts:27-50` scoping cache per viewer.
- `use-categories.ts:79-97,126-159`: общий per-user cache, retry transient, startup prefetch. Проверка userId защищает publish обычного A→B, но generation для A→logout→A отсутствует, а getCachedCategories возвращает value даже при смене owner. Это дополнительный сценарий T10, пока не отдельный подтверждённый finding.
- `notifications.ts:115-281`: global singleton, summary/list/live ingest/read/reset; `hooks.ts:58-112`: auth lifecycle, focus hydrate, 20s disconnected poll. Три исходных async race подробно перечислены в реестре.
- `realtime/client.ts:128-188,220-235,268-354`: lazy SignalR import, shared connection, initial retry 2/5/10/30s, reconnect/resync, branch refcounts. `hooks.ts:139-156` feed resync + 30s fallback; typing TTL 6s, sweep 2s (`199-308`).
- `command-palette/index.tsx:129-147,184-209,379-442`: подготовка read на hover/focus на 3s; open+done+categories Promise.allSettled, 100 active/30 completed, revealHidden по существующему договору, cancelled guard перед setSnapshot. Это не доказательство задержки открытия; недавний fix уже находится в HEAD.
- `branch/[id]/page.tsx:35-48`: отдельный load без epoch; `useTaskActions` используется dashboard/tasks/archive/branch, но каждая страница сохраняет собственные callbacks/options. T11 запрещает нормализовать эти отличия.

## Пользовательские маршруты (inventory)

13 `page.tsx`: `/`, `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/forgot-password/sent`, `/auth/reset-password`, `/auth/verify-email`, `/dashboard`, `/tasks`, `/tasks/completed`, `/categories`, `/profile`, `/branch/[id]`. Route group `(app)` не добавляет сегмент URL. Страницы ошибок/loading/layout отдельно учтены в per-file index. Полные сценарии: регистрация/email verification/reset/session restore/logout; create/edit/complete/duplicate/delete-undo/share/reveal tasks; категории; profile/avatar/friends; search/navigation/keyboard; comments/subtasks/typing; notices/unread/read-all/reconnect.

## Положительные контроли и история

`git log -12 --format='%h %s' -- frontend/src` просмотрен. Важные текущие изменения: `0869759` stale friend-name reads, `3dcaf9d` account-scoped friends, `86ebd60` search warmup/open morph, `08f97cb` notices expiry after manual close, `76bad1c` shared category loading, `7e6428d` viewer category privacy, `84f1bc5` shared author names, `308792b/af20004/7f8c782` shared task actions. Эти названия проверены по истории; auth/friends/current palette source inspected. Исторические FE-24 номера в комментариях не совпадают с новыми FE-001..005: это разные реестры.

`use-friends` generation guards показывают уже установленный локальный паттерн для T10; не следует вводить новый state framework. Проверки raw-token persistence, 429 preservation, CSRF-only retry, timer cleanup, room refcount и notification dedupe существуют. Они не доказывают отсутствие late-response races.

## Диагностическое выполнение исходной логики

Команда D-FE-1..3: PowerShell here-string передан `node` из корня; actual source прочитан `fs.readFileSync`, скомпилирован установленным TypeScript и выполнен в памяти. Зависимости network/JWT/React effect заменены локальными fixtures; `zustand.create` настоящий. Ни файлов приложения, ни тестовых файлов не создавалось, сеть не использовалась. Exit code **0**. Это воспроизведение логики, а не integration/browser test и не официальный Vitest RED.

```text
{"case":"auth-refresh-resolves-after-clearAuth","actualAuthenticated":true,"actualUser":"old-account","expectedAuthenticated":false}
{"case":"notification-load-resolves-after-reset","actualIds":["old-notice"],"actualUsers":["old-account"],"expectedItems":0}
{"case":"branch-unmounted-before-start-resolves","actualJoinsAfterUnmount":1,"leaves":1,"expectedJoinsAfterUnmount":0}
```

Exact harness (PowerShell, cwd repository root):

```powershell
@'
const fs = require('fs');
const ts = require('./frontend/node_modules/typescript');
const {create} = require('./frontend/node_modules/zustand');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function load(file,mocks){const out=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;const m={exports:{}};new Function('require','module','exports',out)(n=>{if(n in mocks)return mocks[n];throw Error('Unexpected import '+n)},m,m.exports);return m.exports;}
(async()=>{
 const d=deferred();
 const auth=load('frontend/src/store/auth.ts',{'zustand':{create},'zustand/middleware':{persist:x=>x,createJSONStorage:()=>null},'@/lib/jwt':{decodeJwt:t=>({sub:t,email:t+'@example.invalid',firstName:'Audit',lastName:'Fixture',exp:Math.floor(Date.now()/1000)+3600}),getJwtEmailVerified:()=>true,getJwtRoles:()=>['User']},'@/lib/auth-public':{refreshAccessToken:()=>d.promise,validateAccessToken:()=>Promise.resolve({isValid:true})},'@/lib/analytics':{PRODUCT_EVENTS:{},flushQueuedProductEvents:()=>{},queueProductEvent:()=>{},trackProductEvent:()=>{}},'@/lib/auth-broadcast':{broadcastLogout:()=>{}},'@/lib/demo/flag':{isDemoSession:()=>true}}).useAuthStore;
 const restoring=auth.getState().restoreSession(); auth.getState().clearAuth(true); d.resolve({accessToken:'old-account'}); await restoring;
 console.log(JSON.stringify({case:'auth-refresh-resolves-after-clearAuth',actualAuthenticated:auth.getState().isAuthenticated,actualUser:auth.getState().user.userId,expectedAuthenticated:false}));
 auth.getState().clearAuth(true);
 const n=deferred();const notices=load('frontend/src/store/notifications.ts',{'zustand':{create},'@/lib/api':{api:{get:()=>n.promise}},'@/store/toast':{useToastStore:{getState:()=>({addToast:()=>{}})}}}).useNotificationStore;
 const loading=notices.getState().loadList();notices.getState().reset();n.resolve({data:[{id:'old-notice',userId:'old-account',taskId:'old-task',actorId:'actor',type:'comment.added',title:'Synthetic private title',message:'Fixture',isRead:false}]});await loading;
 console.log(JSON.stringify({case:'notification-load-resolves-after-reset',actualIds:notices.getState().items.map(x=>x.id),actualUsers:notices.getState().items.map(x=>x.userId),expectedItems:0}));
 const s=deferred();let cleanup;let joins=0;let leaves=0;
 const hooks=load('frontend/src/lib/realtime/hooks.ts',{'react':{useEffect:f=>{cleanup=f()},useRef:v=>({current:v}),useCallback:x=>x,useState:v=>[v,()=>{}]},'@/store/auth':{useAuthStore:f=>f({isAuthenticated:true,accessToken:'fixture'})},'@/lib/demo/flag':{isDemoSession:()=>false},'@/store/notifications':{},'@/lib/notifications/types':{},'@/lib/notifications/web-notifications':{},'@/lib/realtime/client':{realtime:{start:()=>s.promise,joinTask:()=>{joins++;return Promise.resolve()},leaveTask:()=>{leaves++;return Promise.resolve()},on:()=>()=>{}}}});
 hooks.useBranchRoom('fixture-task',()=>{});cleanup();s.resolve();await Promise.resolve();await Promise.resolve();
 console.log(JSON.stringify({case:'branch-unmounted-before-start-resolves',actualJoinsAfterUnmount:joins,leaves,expectedJoinsAfterUnmount:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
'@ | node
```

## Проверки: checkpoint

Первая bounded existing suite (2 workers) начата; после прерывания исходный session handle недоступен. Итог **NO_RESULT**, не pass и не fail:

```powershell
Set-Location F:\Projects\Planora\frontend
npm exec -- vitest run src/test/store/auth.test.ts src/test/store/notifications.test.ts src/test/store/toast.test.ts src/test/hooks/use-friends.test.tsx src/test/hooks/use-categories.test.tsx src/test/lib/notifications-lifecycle.test.tsx src/test/lib/realtime-hooks.test.tsx src/test/lib/api-interceptors.test.ts src/test/components/command-palette.test.tsx src/test/components/toaster.test.tsx --maxWorkers=2
```

Начальный вывод: Vitest 5.0.5; предупреждение Vite native configLoader о ESM config в CJS package; jsdom `Not implemented: navigation to another Document`. Не интерпретировать эти строки как итог pass/fail. Root выполняет общие lint/typecheck; результаты здесь не предполагаются.

После возобновления выполнен меньший завершённый прогон (cwd `F:\Projects\Planora\frontend`):

```powershell
npm exec -- vitest run src/test/store/notifications.test.ts src/test/lib/realtime-hooks.test.tsx src/test/hooks/use-friends.test.tsx --maxWorkers=1
```

**Exit 0: 3 test files, 53 tests passed, 8.53s.** Это существующие baseline tests: они не содержат новых deferred-after-reset/unmount случаев, поэтому успешный результат не опровергает D-FE-1..3. Native-config-loader warning остался; его скрытие не требуется для результата.

## Второй адресный проход

Прочитаны auth screens и поддерживающие security/telemetry/focus/autosave helpers (точный список в frontend-files.json). Дополнительные прямые refresh callers: `src/app/auth/verify-email/page.tsx:57-70`, `src/app/(app)/profile/page.tsx:775-815`; они входят в FE-001, без нового дублирующего finding. T10 назначен владельцем этих узких фрагментов до handoff T11.

Положительные контроли: `csrf.ts` single-flight и CSRF-specific rejection; `client-errors.ts` не отправляет Authorization/query, ограничивает 10 reports и schema paths без значений; `web-notifications.ts` проверяет GUID перед navigation; `use-focus-trap.ts` callback ref учитывает deferred portal mount; `use-scroll-lock.ts` reference count сохраняет nested overlays; `use-autosave.ts` single-flight и pagehide flush; `use-task-visibility.ts` различает masked и owner-private reveal, использует существующий hold-place contract. Эти статические проверки не доказывают browser accessibility или delivery после закрытия вкладки.

Замечания для продолжения: `use-autosave.reset` при старом in-flight save, delayed category external cache handoff и stateful profile loaders требуют ещё deferred tests; нового confirmed дефекта без reproduction не заявлено. Комментарий `auth-flow.ts` про исключение app из coverage и `use-inert.ts` про React18 устарел относительно manifest/config, это точечная документационная задача T15, без изменения поведения.

## Traceability и gaps

| Инвариант | Code | Существующее свидетельство | Недостающая проверка |
|---|---|---|---|
| Logout окончателен для прошлой async работы | auth.ts + api.ts | store/auth.test.ts:602-615 отменяет ожидающий retry | in-flight success/reject after logout, login B |
| Уведомления принадлежат сессии | notifications.ts | store/notifications.test.ts:272-277 проверяет synchronous reset | late response after reset; current-user ingest |
| Cleanup branch symmetrичен join | realtime/hooks.ts | lib/realtime-hooks.test.tsx:98-116 normal join/unmount | deferred start + unmount/ID switch/StrictMode |
| Refresh JWT не хранится в JS | auth.ts partialize | store/auth.test.ts:66+ | retain existing gate, no redesign |
| Search скрытые task rows по установленному договору | palette readSnapshot | components/command-palette.test.tsx | visual equivalence + open first-frame before/after |
| Toast TTL возобновляется после dismissal | toast.ts + ui/toast.tsx | store/toast.test.ts; components/toaster.test.tsx | реальный pointer/keyboard/browser regression |
| Page responses latest-wins | branch load / dashboard / tasks | app/branch-page*.test.tsx; todos/dashboard/completed page tests | реальный A→B remount semantics и late error |
| UI geometry соответствует baseline | E2E motion/height/notices specs | remote run предоставлен root | см. root remote evidence; локально не запускалось |

`vitest.config.ts:36-52` имеет разные ratchets: global 88 lines/81 functions/79 branches/85 statements, non-app/editor 85; pages/editor отдельные. Не понижать и не заменять единым выдуманным 85/100%. Playwright config `35-53`: api и ui/ Desktop Chrome; это не доказательство Safari/Firefox/mobile coverage. `test/setup.ts` глобально stub-ит pointer capture/scroll; jsdom не проверяет настоящую геометрию/focus paint.

## Завершённый inventory checkpoint

`frontend-files.json` содержит **487 tracked paths**: 90 записей REVIEWED, из них **84 полностью и 6 по указанным диапазонам**; 391 NEEDS_DEEP_REVIEW; 5 EXCLUDED_WITH_REASON (brand assets, визуальный просмотр не выполнен); 1 BLOCKED (чужой dirty next-env.d.ts). Для partial REVIEWED остальные строки остаются NEEDS_DEEP_REVIEW по note. Не путать 100% inventory с содержательным аудитом всех файлов.

Полностью прочитаны все tracked app error/loading/layout/template wrappers: route metadata, error isolation, initial loading и motion lifecycle сопоставлены с root/AppShell. Также полностью прочитаны `use-friends.test.tsx` и `use-categories.test.tsx`: friend-cache tests включают warm-microtask/account-generation guard; category tests покрывают normal owner switch, preload, retry и TTL, но не все предложенные deferred races. Это свидетельство исходных assertions, а не новое browser выполнение.

Дальнейший охват: T10 — нерассмотренные auth/cache/realtime tests и session-sensitive callers; T11 — оставшиеся page/component/style источники и визуальная проверка всех 13 routes; T13 — оставшиеся test/fixture/e2e файлы с явной фиксацией READ/REVIEWED. Root T12/T14 владеет package-lock/SCA и build/config verification. Непросмотренный файл нельзя автоматически закрывать успешной общей сборкой.

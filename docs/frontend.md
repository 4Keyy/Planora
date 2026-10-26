# Planora Frontend

How the Next.js application is put together, which patterns are load-bearing, and which
mistakes this codebase has already made so the next one does not repeat them.

For every visual value — colour, type, space, motion, elevation — see
[`design-system.md`](design-system.md). This page covers the architecture around it.

| | |
|---|---|
| Framework | Next.js 16.4.2 (App Router; lockfile version) |
| React | React / React DOM 18.3.1 |
| Language | TypeScript 5.9.3, `strict`, `@/*` → `src/*` |
| Styling | Tailwind 3.4.19; semantic scales derived from `lib/design-tokens.ts` |
| Motion | framer-motion 11.18.2 |
| Primitives | Radix Slot, Dropdown Menu and Popover; custom modal/focus-management components |
| State | Zustand 5.0.15 |
| Realtime | SignalR over the gateway |
| Tests | Vitest + Testing Library; Playwright for e2e and the audit harness |

Versions above are from `frontend/package-lock.json`, verified on 2026-10-06.
`package.json` generally specifies compatible ranges. Use `npm ci` to reproduce
the locked dependency graph; read both files when upgrading.

---

## 1. Directory map

```text
frontend/src/
  app/              route segments; one folder per URL
    layout.tsx      root: fonts, providers, force-dynamic; framework applies the nonce
    globals.css     the focus indicator, utilities, --pl-* variables
  components/
    ui/             the primitives. No product knowledge lives here
    todos/          the task domain: cards, the editor, the branch feed
    layout/         navbar, shells
    notifications/  the bell and its dropdown
    backgrounds/    the WebGL gradient and its static fallback
  hooks/            cross-cutting behaviour (focus trap, scroll lock, autosave)
  lib/              non-React: api client, tokens, animations, realtime, formatting
  store/            zustand stores (auth, notifications, toast)
  types/            DTO shapes shared with the backend
  utils/            pure helpers
  test/             mirrors the tree above; `test/quality/` holds contract tests
```

The rule that keeps this honest: **`components/ui/` knows nothing about tasks.** A
primitive that imports a `Todo` type has stopped being a primitive.

---

### Brand assets and metadata

`components/ui/wordmark.tsx` renders the shared private-ring geometry from `lib/brand-mark.ts`.
It is already used by the application navbar, landing navbar/footer and auth frame; keep those
callers on `Wordmark`. The root layout advertises the adaptive `/favicon.svg`, a 32px PNG fallback,
the 180px Apple touch icon and `/manifest.webmanifest`. `app/manifest.ts` references the same 192px
and 512px paper-tile PNGs, including a maskable entry; it adds installation metadata, not offline
support or a service worker. `/favicon.ico` retains its existing rewrite to the SVG.

`npm run brand:generate` (Node 22.18+) regenerates the public SVG/PNGs and `docs/assets/logo.svg`
from that geometry and `design-tokens.ts`. It uses the Sharp version bundled with Next.js; no new
runtime package or remote font is needed. `npm run brand:check` verifies the generated files.
SVG uses the normalized arc lengths from `Wordmark`; PNG export converts those lengths to the
same physical circumference because raster SVG readers do not consistently support `pathLength`.
See the [product mark contract](design-system.md#product-mark) for geometry and colour rules.

## 2. Rendering model

The whole App Router is `force-dynamic`, declared once in `app/layout.tsx` and
cascading to every route. This is deliberate and documented in
[`DECISIONS/0006-force-dynamic-and-csp-nonce.md`](DECISIONS/0006-force-dynamic-and-csp-nonce.md):
`proxy.ts` mints a per-request CSP nonce. Reusing cached HTML with a fresh
response policy would leave its script nonces mismatched; caching the policy and
HTML together would reuse a nonce across requests. The current design avoids
both by rendering dynamically.

[`slo.md`](slo.md) defines performance targets; it is not evidence that every
current route meets them. Re-measure TTFB against a running production build.

Two consequences that bite:

- Client Components can contribute server-rendered HTML and are then hydrated in the
  browser; Server Components do not all execute again in the browser. Browser-only
  values belong in effects or an explicit client-only boundary. `Date.now()`,
  `Math.random()`, `window`, locale and timezone differences can produce mismatches.
- **`toLocaleDateString()` with no locale is a bug here.** It resolves to the host's
  locale, which is the container's on the server and the visitor's in the browser. All
  shared date-formatting helpers in `lib/datetime.ts` pin `en-US`. They do not pin
  the timezone; an instant near midnight can still format differently on server and
  client. Date pickers and completion windows intentionally use browser-local dates.
- **A task's dates are calendar days, not instants** (`lib/calendar-date.ts`). The editor
  stores a due day, an interval start or an expected day as its midnight UTC, so its UTC date
  is the day the person picked. Read it with `calendarDayOf` and write it with `formatDay`
  (which formats in UTC); compare it with `localDay()`, the viewer's own day. Read in local
  time the stored instant fell on the evening before west of UTC: cards showed the wrong day
  and called tasks overdue a day early. Real timestamps (created, completed, last login) keep
  the local formatting of `lib/datetime.ts`. The server answers urgency by the same rule: the
  client sends its time zone in `X-Time-Zone`, and the Todo API's `isVisuallyUrgent` and urgent
  band use the viewer's day, so the card's red frame, the sort's urgent band and a priority key's
  instant repaint (`priorityFields`) agree with what the server returns.

The route layouts own metadata and shared framing. Interactive route pages, controls,
hooks and stores form explicit client boundaries. Do not infer the rendering model
from a stale count of `"use client"` directives.

### Route ownership

| URL | Responsibility |
|---|---|
| `/` | Public landing page, interactive product explanations and anonymous in-memory sandbox |
| `/auth/login`, `/auth/register` | Credential forms; successful sign-in/registration navigates to `/dashboard` |
| `/auth/forgot-password`, `/auth/forgot-password/sent` | Reset-link request, masked address and resend cooldown |
| `/auth/reset-password`, `/auth/verify-email` | Token-driven recovery and verification |
| `/dashboard` | Active-task overview, statistics and the New task panel |
| `/tasks` | Active feed, category filters, completed preview, keyboard selection and editor |
| `/tasks/completed` | Paginated archive with local-day completion-window filters |
| `/categories` | Category creation, edit/autosave and deletion |
| `/profile` | Identity, account security, sessions, history, friends and role-gated administration |
| `/branch/[id]` | Standalone instance of the same task editor/branch used in the modal |

The `(app)` route group changes layout ownership, not the URL. `AppShell` keeps
the navbar mounted across these routes and places guarded content inside `main#main`.
`AuthGuard` waits for hydration and session restoration before rendering that content.

---

## 3. Authentication and the invariants

Rules from [`INVARIANTS.md`](INVARIANTS.md) constrain the frontend directly, and
none may be relaxed for convenience:

| Invariant | What it means here |
|---|---|
| `INV-AUTH-1` | The access token lives **in memory only**. `store/auth.ts` explicitly excludes it from the persisted slice |
| `INV-AUTH-2` | The refresh token is an httpOnly cookie. The frontend never reads it and cannot |
| `INV-AUTH-3` | The shared API client attempts to attach `X-CSRF-Token` on POST/PUT/PATCH/DELETE; `auth-public.ts` requires successful token preparation. Server enforcement is service-specific; see `auth-security.md` |
| `INV-AZ-3` | Redaction is **server-side**. The client never receives a field it is not allowed to see, so hiding something in the UI is never the security boundary |

Identity is derived from the token's claims by `store/auth.ts` decoding it with
`lib/jwt.ts` — the client only *decodes*, never verifies. Verification is the gateway's
job. This is also why the audit harness can reach an authenticated state by stubbing a
single refresh response.

`SecurityInitializer` bootstraps CSRF, listens for cross-tab logout, restores the
session after Zustand hydration and enriches a missing avatar. Restoration always
tries the httpOnly-cookie refresh when no valid access token is available; it does
not treat missing sessionStorage metadata as proof that the cookie is absent.
The store persists only `user`, token expiry metadata, `roles` and `emailVerified`
under the per-tab sessionStorage key `planora-auth`. Neither authentication flags
nor token strings are part of the persisted slice.

`lib/auth-broadcast.ts` uses `BroadcastChannel` for best-effort logout notification
to other tabs. `clearAuth()` clears local state and broadcasts; it does not itself
revoke a server session or expire the cookie. The navbar calls the logout endpoint
first, then clears local state even when that request fails.

`scheduleTokenRefresh()` keeps one timer per tab: it plans a refresh five minutes
before the access-token expiry, and `setAuth` (a login) and `applyRefresh` (any
refresh) re-arm it, so a login without a reload is covered as well. A failed
scheduled refresh is retried after five minutes; `clearAuth()` cancels the timer and
any pending retry, and the landing sandbox's seeded session schedules nothing.
Foreground API requests also have a separate 401-triggered refresh path. Every
refresh — scheduled, restore or 401 — runs single-flight inside the tab and under the
origin-wide Web Lock `planora:auth-refresh` (`lib/auth-public.ts`), so the tabs of one
browser refresh one after another; where Web Locks are unavailable (an insecure origin
such as a LAN IP over plain http) it runs directly.

---

## 4. Data access

`lib/api.ts` owns the shared Axios instance and named task/comment wrappers.
Pages and hooks also call that instance directly for auth, categories, friends and
task lists. The instance has a 10-second timeout and `withCredentials: true`.
Rules and current behavior:

- Use the shared instance so Authorization, trace context and CSRF handling remain
  consistent. Axios is also imported for cancellation/error predicates.
- Response bodies include bare DTOs as well as `value` and `data` wrappers.
  `parseApiResponse` unwraps those shapes; it does not validate a DTO or throw just
  because an envelope contains `success: false`. HTTP failures reject through Axios.
- `getApiErrorMessage` returns the first available server `message`, nested error,
  `detail`, `title` or exception message. It does **not** sanitize or redact that text.
  Auth forms use the status/code-based mappings in `lib/errors.ts`; other call sites
  may show returned server text. Prefer controlled user copy and an opaque reference
  id when adding error surfaces; `StatusPanel` supports `referenceId`.
- `lib/errors.ts` holds the predicates that classify a failure (`isAuthorAlreadyCompletedError`
  and friends) and the copy for refusals a user cannot act their way out of.
- `getApiBaseUrl()` validates `NEXT_PUBLIC_API_URL`, then the legacy
  `NEXT_PUBLIC_API_GATEWAY_URL`. A local/LAN browser can retarget a local gateway to
  the browser's host on port 5132. A public browser host paired with a configured local
  gateway uses the frontend origin; `NEXT_PUBLIC_API_SAME_ORIGIN=1` explicitly selects
  this proxy path in the browser. Server-side calls still use the configured gateway.

The interceptor attaches a W3C `traceparent` and the viewer's IANA time zone in `X-Time-Zone`
(`viewerTimeZone()` in `lib/calendar-date.ts`; a value already on the request wins), so the Todo
API judges "due today" by the viewer's day. A foreground 401 may share one
refresh request and retry once, preserving the trace id with a new span id.
Auth/login/register/logout/refresh/password-reset failures remain with their forms.
Best-effort calls marked `suppressErrorLog` do not drive the global 401-refresh flow.
A refresh 429 preserves state and backs off using a numeric `Retry-After`, clamped
to 1–300 seconds, with a 60-second fallback. Only a CSRF rejection — a 403 carrying
the middleware's `CSRF_VALIDATION_FAILED` code (`isCsrfRejection` in `lib/csrf.ts`) — clears
the readable CSRF cookie and gets one retry, on a mutating request or in the public auth
client's refresh; any other 403 (a denied action, a locked account on sign-in) surfaces at once,
so a mutation or a password is never sent twice.

### The error-state contract

The preferred contract is a stable loading footprint, a retryable error and an
actionable empty state. Skeletons cover loading; `StatusPanel` covers many empty/error
panels. This is not universal: the branch page uses its own loading/not-found markup,
while optional enrichment and some background polls retain old data or fail silently.

### Logging a failure

Never pass a caught error to `console.*` as it is: an Axios error carries its request
config — the `Authorization` bearer token, the CSRF header and the body. Log
`describeError(error)` (`lib/errors.ts`) instead. It keeps an Axios error's status, method,
URL and code, keeps an `Error`'s name, message and stack, reduces anything else to text, and
redacts `access_token=` values and `Bearer` tokens in whatever text it keeps. `lib/api.ts`
logs HTTP failures the same way (`logApiHttpError`: status, method, URL).

### Reporting a failure

What the console sees, the service logs see too (`lib/client-errors.ts`). `ClientErrorReporter`,
mounted once in the root layout, reports uncaught errors and unhandled rejections; `CrashScene`
(every route and segment error screen, with the digest it shows) and the root `ErrorBoundary`
report the crashes they catch. A report is `describeError`'s name, message and stack, a failed
request's method, path and status, the digest, and the page's path without its query, sent to
`POST /auth/api/v1/client-errors` (`docs/API.md`) without credentials, with CSRF and a fresh
`traceparent`, as a `keepalive` request. The same failure goes once and at most ten a page load;
"Script error." from another origin and the ResizeObserver loop notice are ignored; the demo
sandbox sends nothing, and a report that cannot be sent is dropped silently.

### Checking what the API sends

TypeScript types on `api.get<T>` are assertions, not checks: a field the server renamed or dropped
used to arrive as `undefined` and show up only as a broken screen. The bodies of the most-read GETs
— the task list and a task, the current user, the friend list, the categories — are checked when
they arrive against zod schemas that mirror the server's DTOs field for field
(`lib/api-contract.ts`, run by the response interceptor in `lib/api.ts`). A difference is reported
to the service logs as a `contract` report naming the endpoint and the drifted fields — paths and
type names, never values, with list indices folded (`items.*.priority`) — and the response is handed
on unchanged: the check never fails a request or changes what a screen receives. It costs about
1 ms for a page of 100 tasks. `test/quality/api-contract.contract.test.ts` fails when a schema and its
C# DTO disagree on a field, its kind or its nullability, and the schemas' `satisfies` checks fail
type-checking when they stop matching the types the screens use. Unknown extra fields pass, so the
server can add a field before the client reads it.

---

## 5. State

| Store | Holds | Persisted |
|---|---|---|
| `store/auth.ts` | User identity, in-memory access token, expiry, roles and lifecycle flags | Only user, expiry metadata, roles and email-verification state |
| `store/notifications.ts` | Unread counts, the notification list | No |
| `store/toast.ts` | The transient message queue | No |

Task/category lists and open forms mostly use component state. There is no query-cache
framework, but `use-friends.ts` has a module-global friend cache with a 60-second TTL
and a shared in-flight request. It pages at 200 entries, bounded to 50 pages, and
`invalidateFriends()` is called after relevant profile friend mutations. That cache
is currently not keyed by user id or cleared by `clearAuth()`; do not treat it as a
session-isolated cache. Category-filter preferences in `localStorage` are separately
keyed by user id. Lightweight warning preferences use `planora:pref:*`.

`useAutosave` debounces by 600 ms by default, serializes writes, compares against
the last saved baseline and sends a newer value after the current save succeeds.
It exposes `idle`, `saving`, `saved` and `error`; errors retry on a later edit or
explicit flush. Closing/unmounting attempts a final flush, and so does leaving the page:
closing or reloading the tab never unmounts the editor and the debounce never fires, so on
`pagehide`, or when the tab goes to the background, the pending edit is sent at once. While the page
is hidden, `lib/api.ts` sends writes through axios's fetch adapter with `keepalive` (same headers,
`credentials: "include"`), so the browser finishes them after the page is gone; reads, the demo
sandbox's in-memory adapter and everything once the page is shown again are untouched. This is
best-effort network persistence, not a durable offline queue.

**Guard every async action against re-entry.** Ten places once fired a mutation with no
in-flight guard, including *delete account*, so a second click sent a second request.
`Button`'s `loading` prop blocks the button, announces `aria-busy`, and swaps the label
for a spinner **without changing the button's width**, so the layout around it does not
jump.

---

## 6. Realtime

SignalR, wired through `lib/realtime/`, is loaded on demand: the realtime client imports
`@microsoft/signalr` with `import()` on its first `start()`, which only a signed-in user reaches, so the
landing page, the sign-in screens and the error pages — all of which render the root layout and the
realtime module — no longer download it (13.4 KB gzip per route). The module is fetched once per page;
a failed fetch is retried with the connect backoff below, and a sign-out while it loads builds nothing.
`next/dynamic` is deliberately not used: it would hold the first render. The connection shares one
WebSocket connection to
`/realtime/hubs/notifications`, using `skipNegotiation: true` and an access-token
factory that reads the current in-memory token. There is no long-polling transport
fallback in this client. Initial connection failures use 2/5/10/30-second backoff;
SignalR handles automatic reconnect after a successful connection with its
installed default delays of 0/2/10/30 seconds, then stops retrying. When that closes
the connection, the client's `onclose` handler starts it again on the same 2/5/10/30-second
backoff (a logout ends it). Reconnected branch memberships are rejoined and membership is
reference-counted. The server does not replay what it pushed while the socket was down, so
after a reconnect or a connect that follows a failure the client raises `onResync` (never on
the first connect of a session), and the task feeds read their data again.

| Hook | Purpose |
|---|---|
| `useRealtimeLifecycle()` | Connects and reconnects the hub against auth state |
| `useNotificationsLifecycle()` | Keeps the bell's counts live |
| `useFeedSync(onChange)` | A task list changed somewhere else |
| `useRealtimeResync(onResync)` | The feed may have missed changes: the socket came back, or it has been down another 30 s while the tab is visible and online (not in the sandbox) |
| `useBranchRoom(...)` | Presence and updates inside one task's branch |
| `useTyping(taskId, enabled)` | Ephemeral "is typing" presence |

Typing signals are throttled to two seconds, stop after three seconds of idle,
expire after six seconds and are swept every two seconds.

The notification store hydrates on authentication, focus and visible-tab return.
When the socket is down it polls the summary every 20 seconds while visible; it
deduplicates live ids and caps the in-memory bell list at 100 items. Read actions
are optimistic and reconcile from a later summary on failure. OS notifications
require browser permission and a background/unfocused tab; this is not a service
worker push subsystem. The open branch merges comments/subtasks every nine seconds
as well as reacting to room signals and short post-action catch-up timers.

When a realtime event arrives while the user is working, **reconcile — do not replace**.
Swapping the list wholesale moves the row under the user's cursor and loses their scroll
position.

---

## 6b. Short route aliases

`/login`, `/signin` → `/auth/login`; `/register`, `/signup` → `/auth/register`;
`/reset-password` → `/auth/reset-password`; `/verify-email` → `/auth/verify-email`.
These are permanent **308 redirects** in `next.config.js`; query parameters are
preserved by the redirect behavior.

They exist because those are the paths people type, bookmark and paste into emails, and
without them every one of those is a hard 404 — the pages live under `/auth/*` and nothing
else in the config mapped to them. 308 rather than 302 because the destination is not going
to move, and 308 preserves the method if anything ever POSTs to one by mistake.

Note the ordering constraint this shares with `rewrites()`: the API proxies are deliberately
scoped to `/auth/api/*` so they never shadow the frontend's own `/auth/*` pages.

## 7. The keyboard

The keyboard is a first-class interface here, not an accessibility obligation. On a
desktop this is where an experienced user lives.

| Key | Does | Where |
|---|---|---|
| `Cmd/Ctrl + K` | Command palette — search tasks, categories, people and shortcuts; `#` `@` `>` narrow the search, `Tab` narrows into a row, a query that matches nothing becomes a task | Anywhere, signed in |
| `?` | The keyboard map itself | Anywhere |
| `C` | New task — open the existing panel and focus its title; physical KeyC works in any layout | Dashboard, Tasks |
| `C` | New category — open the creation dialog with the same typing and overlay guards | Categories |
| `F` | Open the category filter | Tasks |
| `Escape` | Close the topmost layer | Everywhere |
| `J` `K` / `↑` `↓` | Move the cursor | Every list of task cards: dashboard, Tasks, archive, landing console |
| `G` `G` / `Shift + G` | First / last task | Every list of task cards |
| `Enter` | Open the task under the cursor (a hidden card opens itself instead) | Every list of task cards, palette |
| `Space` | Complete or reopen it | Every list of task cards |
| `E` | Edit it, starting in the title | Every list of task cards |
| `1`–`5` | Set the priority of the card under the pointer, or of the cursor's — whichever was aimed last (owner's open cards only) | Any task card; the cursor's on every list |
| `X` | Add it to the selection | Tasks |
| `Shift + J/K` / `Shift + ↑/↓` | Extend the selection | Tasks |
| `Cmd/Ctrl + A` | Select everything visible | Tasks |
| `Delete` / `Backspace` | Delete it, with a five-second undo (the archive asks first) | Every list of task cards |

The dashboard also shows the card keys in place: a glass droplet in the bottom-right corner
opens into the landing console's legend, which lights the row of a key that just did something
(`components/todos/keyboard-hints.tsx`; `docs/features.md` § The dashboard's key dock).

`SHORTCUT_GROUPS` in `components/ui/shortcuts-overlay.tsx` defines the `?` map.
The palette and some control hints also declare shortcut labels locally; they do
not all derive them from that array. When a binding changes, check the handler,
the map, palette labels and this table together. Shared `Kbd`/platform helpers
keep spelling and accessibility consistent, but do not synchronize the bindings.

**The `⌘` vs `Ctrl` spelling is resolved after mount, never during render.** The server
has no `navigator`, so reading the platform in render emits `Ctrl` from the server and
`⌘` from the client and React discards the entire server pass as a hydration mismatch.
`useIsApplePlatform()` defaults to the `Ctrl` spelling and corrects itself in an effect.

Four rules keep this coherent:

1. **A single letter never fires while the user is typing.** Every bare-letter handler
   checks that the event target is not an `input`, a `textarea` or a `contenteditable`,
   and that no modifier is held. Without that, typing "category" into a title field
   opens the composer four times.
2. **Escape peels one layer.** Handlers live on the layer that owns them and listen in
   the bubble phase, so a popover inside a dialog can keep the key by calling
   `stopPropagation()`. Escape closes the date picker, not the dialog under it.
3. **A visible hint is `aria-hidden`, and the shortcut is declared with
   `aria-keyshortcuts`.** A `<kbd>C</kbd>` left in the accessibility tree joins the
   button's name, and "New Category" gets announced as "New Category c".
4. **A destructive key acts on the cursor, never on the selection.** `Delete` removes
   the one task under the cursor. Deleting a gathered selection is a press on the
   selection bar, which states the count first — a keystroke that silently took twelve
   tasks because an `x` scrolled out of view is not one anybody can take back.

The command palette shows the shortcut for every command it lists, so it teaches the
rest of the keyboard rather than replacing it; its footer shows the keys for the row under
the highlight, and `?` shows the whole map, the palette's own keys included.

### The list cursor is an id, not an index

`useListNavigation` keys the cursor on the task's id. An index survives nothing the
list does to itself — completing a task removes a row, a filter replaces the array, a
realtime update reorders it — and an index-based cursor then points at a different task
than the one being read. When the active id genuinely disappears the cursor falls back
to the nearest surviving position rather than to nothing; losing your place entirely is
what makes keyboard navigation feel broken.

The cursor is a place plus a visibility (`cursorVisible`). A pointer press anywhere hides it
and leaves the place, so the keyboard resumes from the clicked row; `Tab` into the list and
every navigation key show it. Only `Tab` counts as keyboard focus — it is the one key that
moves DOM focus onto a row — so a dialog opened by a click and closed with `Escape` does not
bring the ring back when focus is returned by script. A hidden cursor is not a target: the row
keys return before any `preventDefault`, and the scroll-into-view effect waits for a shown
cursor so a click never makes the page jump away from the pointer.

The cursor is exposed as `aria-current="true"`, **not** `aria-selected`, and only while it
is shown. Earning
`aria-selected` would mean making rows `role="option"` inside a `role="listbox"`, and an
`option` may not contain focusable descendants — every row here carries a checkbox and a
menu. Claiming listbox semantics anyway would leave a screen reader announcing controls
that, by its own model of the page, cannot exist. Multi-selection is therefore a
`data-selected` attribute for styling, and the fact is spoken by the count on the
selection bar.

The hook is single-instance per page, and that falls out of the design rather than being
configured: the first listener's `preventDefault()` trips the second's
`defaultPrevented` guard. That is correct for a list nested in a list; two independent
lists on one screen would need a scope, and nothing asks for one today.

---

## 8. Component conventions

### Composition

- Primitives in `components/ui/` take `className` last and merge with `cn()`.
- `cn()` is `clsx` + a `tailwind-merge` instance that has been **taught every custom
  scale** (`lib/utils.ts`). This is not optional: `tailwind-merge` treats an unrecognised
  `text-*` as a colour, so `cn("text-body-sm", "text-ink-subtle")` silently dropped the
  size across the whole product until the scales were registered.
- `asChild` (Radix `Slot`) is how a `Button` becomes a `Link` without nesting an anchor
  inside a button.

### Inline styles

Tailwind utilities are the default. Theme values in inline styles should use the
tokens or `--pl-*` CSS variables declared in `globals.css`. Runtime geometry,
progress values and user-provided category colours are data rather than palette
tokens; current code also contains explicit numeric geometry. Prefer shared
tokens for repeated design values without treating every inline value as a token.

An inline style is **never** the right place for a colour literal, a font size below
12px, or a global z-index.

### Page entrances

A block on a signed-in page arrives through `components/animated/entrance.tsx`, never
with its own `initial={{ opacity: 0 }}`: `useEnter(tier, { at, index, ready })` (or
`<Enter>`) on the element itself, `useEnterEach`/`<EnterEach>` on a container whose
children arrive one by one, `<EnterInView>` for what sits below the first screen, and
`SkeletonSwap` around content that has a placeholder. `at` is ms on the page's timeline
(started by `(app)/template.tsx`), the tier is the element's size (`tokens.motion.entrance`).
Pass `ready={false}` while a figure is still on its way, and key a `NumberRoll` or ring
by readiness so it arrives with its value instead of rolling up from 0. Outside the
`(app)` template there is no timeline and these return nothing, so a component used on
the landing page or in a test renders as before. Three things to keep: a plain inline
element does not move (the rise needs a block, an inline-block or a flex item); never put
an entrance on an ancestor of a `position: fixed` control (design-system § 9.11); and a
component that animates its own arrival must stand down inside one that does
(`useArrivalHandled`). The choreography is design-system § 9.13.

### Icons

`lucide-react`. A decorative icon takes `aria-hidden="true"`. An icon that is the only
content of a control needs `aria-label` on the control — `title` is not an accessible
name, because several screen readers do not announce it and it never appears on touch.

---

## 9. Testing

| Suite | Command | Covers |
|---|---|---|
| Unit + component | `npm --prefix frontend run test:coverage` | V8 gate: ≥85% statements, branches, functions and lines in the included source scope |
| Design-system contract | `src/test/quality/design-tokens.contract.test.ts` | The five rules, read from source |
| Usability contract | `src/test/quality/usability-contract.test.tsx` | Copy and affordances that must not regress |
| Dead-CSS scan | `node docs/ui-audit/tools/class-audit.mjs` | Classes that emit no rule. **Needs a build first** |
| Static a11y | `node docs/ui-audit/tools/a11y-static.mjs` | Names, keyboard paths, tab order |
| Focus indicators | `node docs/ui-audit/tools/focus-scan.mjs` | Reached focus stops and contrast. **Needs a running production server**; this does not establish complete WCAG conformance |
| Live matrix | `node docs/ui-audit/tools/live-scan.mjs` | Fixture-backed routes/viewports/modes configured in the script. Web vitals are read before the full-page screenshot; preserve the report's actual reached cells and date |
| E2E | `npx playwright test` | Real flows against a live stack |

The final 2026-10-06 coverage run at `b2e9c70` passed **100 test files / 1,231 tests**: statements
94.48%, branches 86.46%, functions 94.20%, lines 96.34%. This is a dated
measurement, not a fixed test-count gate. Coverage excludes `src/app/**` and the
entire `src/components/todos/edit-todo-modal/**` subtree; tests can still execute
excluded code, but those percentages cannot establish its coverage. See
[`testing.md`](testing.md) for commands, artifacts and integration-test limits.

### Testing associations, not appearance

The tests that earn their keep here assert **relationships**: that a label names its
control, that an error describes rather than names it, that a dialog traps Tab. Every
one of those was broken at some point while the UI looked perfectly fine.

A test that re-derives its expectation from the same mechanism it is testing proves
nothing. `formatDate` is asserted against a literal string, not against
`toLocaleDateString()` — otherwise removing the locale pinning would keep the test green.

### Never suppress the focus indicator

`globals.css` declares it once, through a `:where()` selector with zero specificity so
a component can add to it and nothing needs to fight it. Two idioms take it away
silently: Tailwind's `outline-none` sets `2px solid transparent` rather than removing
anything, and an inline `outline: "none"` beats the stylesheet outright. Both shipped
here, leaving six auth routes and every Button variant with no visible focus at all.
See [`design-system.md`](design-system.md) for the measured figures.

Text fields are the one place the ring is replaced rather than kept, because an input
matches `:focus-visible` on every click: give a boxed field `field-box` (the `<Input>`
and `<Textarea>` primitives already do), and a naked field `field-naked` inside a
`field-rule` or `field-shell` container that draws the indicator. Those classes make the
outline transparent in `globals.css`; a component still never writes `outline-none`.

### The lesson from the focus trap

`useFocusTrap` had a full test suite and every test passed. It also did nothing in
production, because the tests mounted it directly while every real caller mounts it
through `ModalPortal`, which renders `null` on its first pass. **Test the composition
the product actually ships**, not the unit in isolation.

---

## 10. Performance

The table below is a **historical UI-audit measurement**, retained for comparison.
It is not a fresh measurement of the 2026-10-06 tree. The fixture-backed audit,
environment and measurement history are recorded in
[`ui-audit/RESULTS.md`](ui-audit/RESULTS.md); repeat the scripts before using
these values as release evidence.

| | |
|---|---|
| JS chunks | 1833.0 KB across 46 files (was 2229.4 KB) |
| Fonts | 8 files, 232 KB (was 24 files, 492 KB) |
| Max CLS across the matrix | 0.115 |
| Max LCP across the matrix | 2384 ms |

The earlier audit recorded an 18 KB increase from its low point after the
palette, counters and undo window. Do not infer the current bundle size from it.

Build configuration keeps import optimization scoped to installed Framer Motion,
Lucide and Radix Dropdown Menu/Popover packages. It disables `X-Powered-By` and has no
Server Actions override while there are no `use server` actions. `tw-animate-css` was
unused and removed; the existing Tailwind animation plugin is retained. A paired
2026-10-20 build comparison on identical sources showed zero byte growth for every
route and the static JS/CSS total. See [the bundle report](testing.md#bundle-size-report-and-budgets).

Decisions worth knowing:

- **The WebGL background is raw WebGL, not three.js.** three.js cost 506.7 KB — 23% of
  the bundle — to draw one fullscreen quad with one fragment shader. The shader is
  unchanged; only the ~90 lines of plumbing differ.
- **It is lazy and scoped to `/`.** `ColorBendsLayer` starts with the static
  gradient and upgrades on that route after load/idle. Coarse pointers, viewports
  ≤768 px, Save-Data, reported `deviceMemory ≤ 2` or `hardwareConcurrency ≤ 2`
  retain the static gradient. Other routes remain static even on capable desktops.
- **The render loop stops when the tab is hidden**, and a lost WebGL context parks it
  rather than freezing on the last frame.

The tasks page fetches active pages of 200 up to a 100-page safety bound and
progressively mounts 24 more cards as its sentinel enters view. Mounted cards
are not evicted, so this is incremental rendering, not a fixed-size virtualization
window. Category filtering and smart sorting run over the fetched data; the
completed preview uses 20 items and the separate archive paginates at 20.
The palette loads the first 100 active tasks when opened and filters that set
locally; it is not a search over every page of the repository's task data.

`MasonryColumns` re-deals the whole grid on every change of the list or of the
column count: in list order, each card to the shortest column, the leftmost of
those within a row of it (`ROW_PX`, 24px), by measured height (`dealColumns`).
Reading the grid left to right and top to bottom therefore reads the sorted list
— a row of near-equal columns is dealt left to right — and DOM and keyboard order
are the list's. Cards are children of one box, placed by `x`/`y` motion values;
every move glides on `SPRING_LAYOUT` from the card's current speed, a leaving
card fades in place under one `AnimatePresence`, and a card whose height changes
pushes the cards below it in step and is re-dealt around 180ms after it settles.
The first (server) paint is a CSS grid; the cards are measured and placed in a
layout effect before the first client paint. The entrance stagger applies to the
first paint and to a new `deal` (a dashboard page), not to later insertions.

HTML motion surfaces import `motion` from `@/components/ui/motion`; hooks, controls,
types and `AnimatePresence` still come from `framer-motion`. The shared facade gives
animated opacity an externally created `MotionValue`, keeping it on Framer's frame
renderer to avoid Framer 11's native-animation cancellation resetting opacity for
one frame. Existing transform targets, transitions and layout projection remain
unchanged. Geometry-only elements keep their CSS opacity; caller-owned motion
values and SVG tags retain native behavior. Do not bypass the facade for a new
HTML fade without checking its native-animation completion in the browser.

### Landing sandbox boundary

`DemoSandbox` waits for hydration and real-session restoration. A signed-in
visitor keeps their session and sees a link to their own tasks. An anonymous
visitor receives invented data via an in-memory Axios adapter and a synthetic
client-decoded token. The demo suppresses realtime/notification lifecycle and
seeds a readable CSRF value for its local writes; teardown restores the prior
adapter/cookie, silently clears the demo auth and removes its persisted identity.
Demo actions are local; initial page load/session-restoration and static assets
can still make network requests. Do not describe the whole landing page as offline.

---

## 11. Local development

```powershell
npm ci --prefix frontend
npm --prefix frontend run dev          # http://localhost:3000
npm --prefix frontend run type-check
npm --prefix frontend run test:coverage
npm --prefix frontend run build
```

Use `next build` followed by `next start` for the production CSP, chunk-loading
and browser-audit checks. Development mode is useful for editing, but has different
HMR, CSP and rendering timing. Wait for an observable page state rather than relying
on `networkidle` for a page with long-lived realtime/background work.

Two traps this machine has hit before, recorded in
[`troubleshooting.md`](troubleshooting.md):

- **Rebuilding under a running server** leaves a torn `.next`; the browser then gets
  `text/plain` for JS and CSS and the page dies with a `ChunkLoadError` that looks like
  an application crash. Stop the server before replacing its build, or use the
  separate `NEXT_DIST_DIR` workflow in [`development.md`](development.md).
- **`next-env.d.ts` churns** between dev and production builds. It is generated; do not
  commit the flip.

---

## 12. The checklist before a frontend commit

1. `npx tsc --noEmit` — clean.
2. `npm run build` — clean.
3. `npm run test:coverage` — green across all four configured 85% thresholds.
4. `node ../docs/ui-audit/tools/class-audit.mjs` — every class emits a rule.
5. `node ../docs/ui-audit/tools/a11y-static.mjs` — no unnamed control, no unreachable one.
6. If you touched anything focusable, `node ../docs/ui-audit/tools/focus-scan.mjs` against a
   running production server — every focus stop still clears 3:1.
7. If the change is visible, look at it in a real browser at 390px and at 1440px,
   including keyboard, reduced-motion and relevant error states.
8. Docs updated — this page, [`design-system.md`](design-system.md), or
   [`features.md`](features.md), whichever the change touched.

---

## See also

- [`design-system.md`](design-system.md) — every token, rule and primitive
- [`ui-audit/`](ui-audit/) — the audit: research, defects, target state, blueprint, results
- [`architecture.md`](architecture.md) — the services behind the API
- [`API.md`](API.md) — endpoint reference
- [`INVARIANTS.md`](INVARIANTS.md) — the rules that outrank convenience
- [`testing.md`](testing.md) — the full test strategy

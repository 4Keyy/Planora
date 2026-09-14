# Planora Frontend

How the Next.js application is put together, which patterns are load-bearing, and which
mistakes this codebase has already made so the next one does not repeat them.

For every visual value — colour, type, space, motion, elevation — see
[`design-system.md`](design-system.md). This page covers the architecture around it.

| | |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| React | 18.3 |
| Language | TypeScript, `strict` |
| Styling | Tailwind 3.4, theme derived from `lib/design-tokens.ts` |
| Motion | framer-motion 11 |
| Primitives | Radix UI (`@radix-ui/react-slot`, dropdown, select, dialog) |
| State | zustand |
| Realtime | SignalR over the gateway |
| Tests | Vitest + Testing Library; Playwright for e2e and the audit harness |

---

## 1. Directory map

```
frontend/src/
  app/              route segments; one folder per URL
    layout.tsx      root: fonts, CSP nonce consumer, providers, force-dynamic
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

## 2. Rendering model

The whole App Router is `force-dynamic`, declared once in `app/layout.tsx:71` and
cascading to every route. This is deliberate and documented in
[`DECISIONS/0006-force-dynamic-and-csp-nonce.md`](DECISIONS/0006-force-dynamic-and-csp-nonce.md):
`middleware.ts` mints a per-request CSP nonce, and a statically rendered page would
serve a cached nonce, which is the same as having no nonce at all.

The cost is measured, not assumed: TTFB against SLO-02 (p95 ≤ 400ms) in
[`slo.md`](slo.md).

Two consequences that bite:

- **Every component renders twice** — once on the server, once during hydration. Any
  value that differs between the two produces a hydration mismatch and React discards
  the server pass. `Date.now()`, `Math.random()`, `window`, and an implicit locale are
  the usual causes.
- **`toLocaleDateString()` with no locale is a bug here.** It resolves to the host's
  locale, which is the container's on the server and the visitor's in the browser. All
  date formatting goes through `lib/datetime.ts`, which pins the locale in one place.

Of 90 `.tsx` files, 64 are `"use client"`. That is high, and it is honest: this is an
interactive product, and a component that owns state, a handler or an effect must be a
client component.

---

## 3. Authentication and the invariants

Three rules from [`INVARIANTS.md`](INVARIANTS.md) constrain the frontend directly, and
none may be relaxed for convenience:

| Invariant | What it means here |
|---|---|
| `INV-AUTH-1` | The access token lives **in memory only**. `store/auth.ts` explicitly excludes it from the persisted slice |
| `INV-AUTH-2` | The refresh token is an httpOnly cookie. The frontend never reads it and cannot |
| `INV-AUTH-3` | Every mutating request carries a CSRF token — see `lib/csrf.ts` |
| `INV-AZ-3` | Redaction is **server-side**. The client never receives a field it is not allowed to see, so hiding something in the UI is never the security boundary |

Identity is derived from the token's claims by `store/auth.ts` decoding it with
`lib/jwt.ts` — the client only *decodes*, never verifies. Verification is the gateway's
job. This is also why the audit harness can reach an authenticated state by stubbing a
single refresh response.

`lib/auth-broadcast.ts` keeps tabs in step: signing out in one tab signs out the rest.

---

## 4. Data access

`lib/api.ts` owns the axios instance and every endpoint wrapper. Rules:

- **Components never call `axios` directly.** An endpoint gets a named function here.
- Responses come back in an `ApiResponse<T>` envelope; `parseApiResponse` unwraps it and
  throws on failure, so a caller's `try/catch` is the error path.
- `getApiErrorMessage(error, fallback)` produces something a user can read. **Never put
  a raw server message on screen** — it can carry a stack trace or another user's data,
  and it means nothing to the reader. `StatusPanel` deliberately has no slot for one; it
  takes a `referenceId` instead.
- `lib/errors.ts` holds the predicates that classify a failure (`isAuthorAlreadyCompletedError`
  and friends) and the copy for refusals a user cannot act their way out of.
- `lib/config.ts` `getApiBaseUrl()` resolves the gateway against the host the page was
  *opened from*, not the host baked at build time. That is what makes a LAN or tunnel
  viewer work, and the CSP in `middleware.ts` is written to match.

### The error-state contract

Every fetch path owes the user three things: a loading state that does not shift the
layout when it resolves, an error state **with a retry**, and an empty state that says
what to do next. All three are `StatusPanel`. Three error states in this product used to
offer nothing at all — a full page reload was the only way forward.

---

## 5. State

| Store | Holds | Persisted |
|---|---|---|
| `store/auth.ts` | User identity, token expiry, hydration flag | Everything **except** the access token |
| `store/notifications.ts` | Unread counts, the notification list | No |
| `store/toast.ts` | The transient message queue | No |

Everything else is component state. There is no global cache: lists are fetched by the
page that shows them and reconciled against realtime events.

**Guard every async action against re-entry.** Ten places once fired a mutation with no
in-flight guard, including *delete account*, so a second click sent a second request.
`Button`'s `loading` prop blocks the button, announces `aria-busy`, and swaps the label
for a spinner **without changing the button's width**, so the layout around it does not
jump.

---

## 6. Realtime

SignalR, wired through `lib/realtime/`:

| Hook | Purpose |
|---|---|
| `useRealtimeLifecycle()` | Connects and reconnects the hub against auth state |
| `useNotificationsLifecycle()` | Keeps the bell's counts live |
| `useFeedSync(onChange)` | A task list changed somewhere else |
| `useBranchRoom(...)` | Presence and updates inside one task's branch |
| `useTyping(taskId, enabled)` | Ephemeral "is typing" presence |

Typing presence entries carry a TTL and are swept on an interval, because a dropped
`StopTyping` would otherwise leave a stuck "… is typing" forever.

When a realtime event arrives while the user is working, **reconcile — do not replace**.
Swapping the list wholesale moves the row under the user's cursor and loses their scroll
position.

---

## 7. The keyboard

The keyboard is a first-class interface here, not an accessibility obligation. On a
desktop this is where an experienced user lives.

| Key | Does | Where |
|---|---|---|
| `Cmd/Ctrl + K` | Command palette — search tasks, jump anywhere, create | Anywhere, signed in |
| `?` | The keyboard map itself | Anywhere |
| `C` | Capture a task — one field, no selectors | Dashboard, Tasks |
| `F` | Open the category filter | Tasks |
| `Escape` | Close the topmost layer | Everywhere |
| `J` `K` / `↑` `↓` | Move the cursor | Task list |
| `G` `G` / `Shift + G` | First / last task | Task list |
| `Enter` | Open the task under the cursor | Task list, palette |
| `Space` | Complete or reopen it | Task list |
| `E` | Edit it | Task list |
| `1`–`5` | Set its priority (owner only) | Task list |
| `X` | Add it to the selection | Task list |
| `Shift + J/K` / `Shift + ↑/↓` | Extend the selection | Task list |
| `Cmd/Ctrl + A` | Select everything visible | Task list |
| `Delete` / `Backspace` | Delete it, with a five-second undo | Task list |

**One list is the source of truth.** `SHORTCUT_GROUPS` in
`components/ui/shortcuts-overlay.tsx` is exported and consumed by the `?` map; a second
hand-written list would drift the moment a binding moved. The table above is the only
copy that is not generated, and it is the one to check when a binding changes.

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
rest of the keyboard rather than replacing it, and `?` shows the whole map.

### The list cursor is an id, not an index

`useListNavigation` keys the cursor on the task's id. An index survives nothing the
list does to itself — completing a task removes a row, a filter replaces the array, a
realtime update reorders it — and an index-based cursor then points at a different task
than the one being read. When the active id genuinely disappears the cursor falls back
to the nearest surviving position rather than to nothing; losing your place entirely is
what makes keyboard navigation feel broken.

The cursor is exposed as `aria-current="true"`, **not** `aria-selected`. Earning
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

Tailwind utilities are the default. Where a value must be computed at runtime — a
progress width, a user's category colour, a popover's measured position — an inline
style is correct, and the value must still come from a token, through the `--pl-*` CSS
variables declared in `globals.css`.

An inline style is **never** the right place for a colour literal, a font size below
12px, or a global z-index.

### Icons

`lucide-react`. A decorative icon takes `aria-hidden="true"`. An icon that is the only
content of a control needs `aria-label` on the control — `title` is not an accessible
name, because several screen readers do not announce it and it never appears on touch.

---

## 9. Testing

| Suite | Command | Covers |
|---|---|---|
| Unit + component | `npx vitest run` | 688 tests. Gate: 85% branches |
| Design-system contract | `src/test/quality/design-tokens.contract.test.ts` | The five rules, read from source |
| Usability contract | `src/test/quality/usability-contract.test.tsx` | Copy and affordances that must not regress |
| Dead-CSS scan | `node docs/ui-audit/tools/class-audit.mjs` | Classes that emit no rule. **Needs a build first** |
| Static a11y | `node docs/ui-audit/tools/a11y-static.mjs` | Names, keyboard paths, tab order |
| Focus indicators | `node docs/ui-audit/tools/focus-scan.mjs` | Every focus stop, measured against 2.4.11's 3:1. **Needs a running server** |
| Live matrix | `node docs/ui-audit/tools/live-scan.mjs` | 12 routes × 9 viewports × 3 modes |
| E2E | `npx playwright test` | Real flows against a live stack |

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

### The lesson from the focus trap

`useFocusTrap` had a full test suite and every test passed. It also did nothing in
production, because the tests mounted it directly while every real caller mounts it
through `ModalPortal`, which renders `null` on its first pass. **Test the composition
the product actually ships**, not the unit in isolation.

---

## 10. Performance

Measured in a production build, not in dev.

| | |
|---|---|
| JS chunks | 1833.0 KB across 46 files (was 2229.4 KB) |
| Fonts | 8 files, 232 KB (was 24 files, 492 KB) |
| Max CLS across the matrix | 0.115 |
| Max LCP across the matrix | 2384 ms |

The bundle grew 18 KB from its low point when the command palette, the rolling
counters and the undo window landed. That is the honest trade: the palette alone is
worth more than 18 KB of the 506 KB that three.js used to spend on one quad.

Decisions worth knowing:

- **The WebGL background is raw WebGL, not three.js.** three.js cost 506.7 KB — 23% of
  the bundle — to draw one fullscreen quad with one fragment shader. The shader is
  unchanged; only the ~90 lines of plumbing differ.
- **It is lazy, and phones never fetch it.** `ColorBendsLayer` upgrades to the live
  shader only after mount, and only for a fine pointer on a wide viewport with enough
  cores and memory. Touch, small viewport, `deviceMemory ≤ 2`, `hardwareConcurrency ≤ 2`
  and Save-Data all keep the static CSS gradient and never load the chunk.
- **The render loop stops when the tab is hidden**, and a lost WebGL context parks it
  rather than freezing on the last frame.

---

## 11. Local development

```bash
cd frontend
npm run dev            # http://localhost:3000
npm run build          # production build — the only build the audit tools trust
npx vitest run         # tests
npx vitest run --coverage
```

Run the browser through the preview tooling rather than a bare `npm run dev` when you
need to *verify* something: a dev server's HMR socket never lets a page reach
`networkidle`, and on a proxied machine it can block hydration entirely, which looks
exactly like a broken product.

Two traps this machine has hit before, recorded in
[`troubleshooting.md`](troubleshooting.md):

- **Rebuilding under a running server** leaves a torn `.next`; the browser then gets
  `text/plain` for JS and CSS and the page dies with a `ChunkLoadError` that looks like
  an application crash. Stop the server, `rm -rf .next`, rebuild, restart.
- **`next-env.d.ts` churns** between dev and production builds. It is generated; do not
  commit the flip.

---

## 12. The checklist before a frontend commit

1. `npx tsc --noEmit` — clean.
2. `npm run build` — clean.
3. `npx vitest run` — green, branches ≥ 85%.
4. `node ../docs/ui-audit/tools/class-audit.mjs` — every class emits a rule.
5. `node ../docs/ui-audit/tools/a11y-static.mjs` — no unnamed control, no unreachable one.
5b. If you touched anything focusable, `node ../docs/ui-audit/tools/focus-scan.mjs` against a
   running production server — every focus stop still clears 3:1.
6. If the change is visible, look at it in a real browser at 390px and at 1440px.
7. Docs updated — this page, [`design-system.md`](design-system.md), or
   [`features.md`](features.md), whichever the change touched.

---

## See also

- [`design-system.md`](design-system.md) — every token, rule and primitive
- [`ui-audit/`](ui-audit/) — the audit: research, defects, target state, blueprint, results
- [`architecture.md`](architecture.md) — the services behind the API
- [`API.md`](API.md) — endpoint reference
- [`INVARIANTS.md`](INVARIANTS.md) — the rules that outrank convenience
- [`testing.md`](testing.md) — the full test strategy

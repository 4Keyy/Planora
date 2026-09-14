# Planora Design System

Every visual value the product ships, where it comes from, and the rule it obeys.

This is not a style guide anyone can ignore. The values live in one TypeScript file,
the Tailwind theme is derived from it, and the rules below are enforced by tests that
read the source tree. If something here is wrong, a test fails.

| Thing | File |
|---|---|
| The tokens | `frontend/src/lib/design-tokens.ts` |
| The Tailwind theme, derived | `frontend/tailwind.config.ts` |
| CSS variables for inline styles | `frontend/src/app/globals.css` |
| Motion, derived from the tokens | `frontend/src/lib/animations.ts` |
| The rules, enforced | `frontend/src/test/quality/design-tokens.contract.test.ts` |

> Contrast figures are computed against `paper` (`#ffffff`) with the WCAG 2.2
> relative-luminance formula by `docs/ui-audit/tools/contrast-scan.mjs`, and
> re-measured in a real browser by `docs/ui-audit/tools/live-scan.mjs`.

---

## 1. The five rules

These are the constitution. Each is enforced by a named test, and each exists because
something measurably went wrong without it.

| # | Rule | Why | Enforced by |
|---|---|---|---|
| 1 | No colour literal in a component | 441 uses across 98 distinct values, none of them coordinated | `rule 1 — no colour literal in a component` |
| 2 | No text below 12px | 47% of the product's text sat under the floor: 9px ×57, 10px ×729, 11px ×573 | `rule 2 — no text below 12px` |
| 3 | Four font weights, and exactly four loaded faces | A weight with no file behind it gets a synthetic, smeared face and no error | `rule 3 — four font weights, and four loaded faces` |
| 4 | One focus indicator, clearing 3:1 | 8 of 8 focus indicators failed WCAG 2.4.11 | `rule 4 — one focus indicator, clearing 2.4.11` |
| 5 | Priority is never encoded by hue alone | Five priority hues collapse under deuteranopia — OKLab distance 0.049 between the two lowest, below the just-noticeable threshold | `rule 5 — priority is never encoded by hue alone` |

### The `@colour-data` exemption

Four files legitimately contain colour literals, because in them colour is **data**,
not theme:

| File | What the colours are |
|---|---|
| `components/todos/edit-todo-modal/utils.ts` | The twelve category swatches a user picks from. Their choice, stored against their data. |
| `lib/notifications/types.ts` | Per-notification-type tints. Identity, the way an app icon is identity. |
| `lib/utils.ts` | WCAG luminance coefficients and sRGB transfer breakpoints, used to decide ink over a user's chosen colour. |
| `components/todos/edit-todo-modal/color-picker.tsx` | The six primaries of the HSL wheel. Coordinate space, not a palette. |

Each carries an `@colour-data` marker in a comment with its reason, and the contract
test keys off that marker rather than a list held elsewhere. Three separate sweeps
have corrupted these values by mistaking them for theme; the exemption is kept next to
the values so the next person editing them sees it.

---

## 2. Colour

The product has **one** saturated colour (`alert`) and **one** accent. Everything else
is a neutral. Restraint is the design, not a limitation.

### Ink — text and marks

| Token | Value | Contrast on paper | Use for |
|---|---|---|---|
| `ink` | `#171717` | 17.93:1 | Primary text |
| `ink-muted` | `#525252` | 7.81:1 | Secondary text, and the **minimum** for anything under 14px |
| `ink-subtle` | `#737373` | 4.74:1 | Muted text at 14px and above. The floor for body copy |
| `ink-faint` | `#a3a3a3` | 2.52:1 | **NON-TEXT ONLY** — dividers, inactive icons, decorative strokes |

`ink-faint` fails 1.4.3 at any size. `text-ink-faint` is never correct. Note that
`gray-400` is the same `#a3a3a3`: using it as a text colour is the same defect wearing
a different name, and nine places did exactly that.

### Line — borders

| Token | Value | Contrast | Use for |
|---|---|---|---|
| `line` | `#e5e5e5` | 1.26:1 | Card and section borders. Decorative, never an affordance |
| `line-strong` | `#767676` | 4.54:1 | Form-control borders — clears 1.4.11's 3:1 for UI components |

A border a user is meant to aim at is `line-strong`. A border that merely separates two
regions is `line`.

### Paper — surfaces, and the reverse ramp

| Token | Value | Note |
|---|---|---|
| `paper` | `#ffffff` | The page |
| `paper-sunken` | `#fafafa` | Recessed fills, plates, inactive tabs |
| `paper-raised` | `#ffffff` | Cards over `paper-sunken` |
| `paper-muted` | `#e5e5e5` | Text **on** an ink surface — 14.4:1 on ink |
| `paper-subtle` | `#a3a3a3` | Muted text on an ink surface — 7.44:1 on ink |

The auth pages carry a dark marketing panel, so the ramp has to run in reverse there.
Reusing `ink-muted` on `#171717` measured 2.29:1, which is why `paper-muted` and
`paper-subtle` exist as their own tokens rather than as opacity on white.

### Semantic colour

| Token | Value | Contrast | Means exactly |
|---|---|---|---|
| `accent` | `#0369a1` | 5.93:1 | Links, active tab, selection. The previous `#0ea5e9` measured 2.77:1 and could not carry text |
| `accent-surface` | `#e0f2fe` | — | A **background fill**. Eight places used it as a text colour at ~1.2:1 |
| `alert` | `#b91c1c` | 7.00:1 | Overdue, or a destructive action being confirmed. Nothing else |
| `alert-surface` | `#fef2f2` | — | Background behind alert content |
| `positive` | `#15803d` | 4.53:1 | Confirmation. State, never decoration |
| `positive-surface` | `#f0fdf4` | — | Background behind positive content |
| `warn` | `#a16207` | 4.93:1 | Approaching a limit, unverified email |
| `warn-surface` | `#fffbeb` | — | Background behind warn content |
| `focus` | `#0a0a0a` | 18.88:1 | The focus indicator, everywhere |

**A `-surface` token is a background.** It is never a text or icon colour. The rule is
mechanical: if a token's name ends in `-surface`, `text-*` and icon `color` are wrong.

### The neutral ramp

`gray-50` through `gray-900` exists because it is genuinely well-spaced, and the
semantic tokens are drawn from it. **Use the semantic names in components.** A
`gray-*` class in a component is a value that has lost its reason.

```
50  #fafafa   150 #eeeeee   300 #d4d4d4   500 #737373   700 #404040   900 #171717
100 #f5f5f5   200 #e5e5e5   400 #a3a3a3   600 #525252   800 #262626
```

---

## 3. Type

One family: **Plus Jakarta Sans**, loaded in exactly four weights across the `latin`
and `latin-ext` subsets — eight font files, 232 KB.

### The scale

| Token | Size | Line height | Tracking | Use for |
|---|---|---|---|---|
| `caption` | 12px | 16px | 0 | Metadata, eyebrow labels, counters. **The floor** |
| `body-sm` | 14px | 20px | 0 | The product's default body |
| `body` | 16px | 24px | 0 | Long-form reading |
| `title-sm` | 20px | 28px | −0.01em | Card and section titles |
| `title` | 24px | 32px | −0.015em | Page titles |
| `display-sm` | 32px | 38px | −0.02em | Marketing sub-headings |
| `display` | 44px | 48px | −0.025em | Marketing headings |
| `hero` | 64px | 64px | −0.03em | The landing hero, once |

Tracking tightens as size grows. That is not decoration: at display sizes the default
letter-spacing reads as loose, and at 12px any negative tracking costs legibility.

### Weights

| Token | Value | Use for |
|---|---|---|
| `font-normal` | 400 | Body copy |
| `font-medium` | 500 | Emphasis inside body copy |
| `font-semibold` | 600 | Controls, labels |
| `font-bold` | 700 | Headings, numbers that matter |

These four are loaded and no others. Asking for a weight outside the scale costs a
**synthetic face**: the browser smears the nearest real weight and reports nothing.
One `font-weight: 900` in the colour picker asked for a face that has never existed in
this product.

### The eyebrow label

There is one, exported as `FIELD_LABEL_CLASS` from `components/ui/field.tsx`:

```
text-caption font-semibold uppercase tracking-wider text-ink-muted
```

It uses `ink-muted` (7.81:1) rather than `ink-subtle` (4.74:1) because 12px uppercase is
the hardest combination to read and belongs well clear of the floor rather than on it.
Three different eyebrow styles existed before this — nobody could see the difference
while reading any one file.

---

## 4. Space

Ten steps on a 4px grid: `0 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96`.

The grid is the point. A value off the grid is a value someone eyeballed, and two
people eyeballing the same gap produce 14px and 18px.

---

## 5. Shape

| Token | Value | Use for |
|---|---|---|
| `rounded-none` | 0 | Full-bleed edges |
| `rounded-sm` | 8px | Chips, small controls |
| `rounded-md` | 12px | Buttons, inputs, menu items |
| `rounded-lg` | 16px | Cards |
| `rounded-xl` | 20px | Dialogs, sheets, large panels |
| `rounded-full` | 9999px | Avatars, pills, dots |

---

## 6. Elevation

Five levels, each **two-layered** so the shadow reads as depth rather than as blur: a
tight contact shadow plus a wide ambient one.

| Token | Value |
|---|---|
| `shadow-none` | `none` |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06)` |
| `shadow-md` | `0 2px 4px rgba(0,0,0,.04), 0 4px 8px rgba(0,0,0,.06)` |
| `shadow-lg` | `0 4px 8px rgba(0,0,0,.04), 0 12px 24px rgba(0,0,0,.08)` |
| `shadow-xl` | `0 8px 16px rgba(0,0,0,.06), 0 24px 48px rgba(0,0,0,.12)` |

Tailwind's own `shadow-sm/md/lg/xl/2xl` are **removed** in the config rather than
extended. They used to win 98 uses to 19 against this scale, simply by being the name
people reach for first.

---

## 7. Layers

Eight named tiers. There are no numeric global z-index values in the product.

| Token | Value |
|---|---|
| `z-base` | 0 |
| `z-dropdown` | 1000 |
| `z-sticky` | 1100 |
| `z-overlay` | 1200 |
| `z-modal` | 1300 |
| `z-popover` | 1400 |
| `z-toast` | 1500 |
| `z-tooltip` | 1600 |

`toast` sits **above** `modal` deliberately: a message hidden behind the dialog that
triggered it is a message the user never receives.

**Local stacking is different and is fine.** A single-digit `zIndex` on one
absolutely-positioned child over its sibling inside the same component is ordinary CSS
and the scale has nothing to say about it. Ten and above is a claim about where an
element sits relative to the rest of the product, and that claim must come from the
scale. The contract test draws the line at 10.

---

## 8. Motion

Five durations, three curves, three springs. **Every animated value is a `transform` or
an `opacity`** — nothing else composites on the GPU, and anything else costs layout or
paint on every frame.

### Durations

| Token | Value | Use for |
|---|---|---|
| `instant` | 100ms | Colour change, press feedback |
| `fast` | 160ms | Tooltip, chip, inline error |
| `base` | 220ms | Modal, popover, toast, element move. **The default** |
| `slow` | 320ms | Bottom sheet, large layout change. The UI ceiling |
| `deliberate` | 480ms | **Non-UI only** — number roller, progress ring |

### Curves

| Token | Value | Use for |
|---|---|---|
| `ease-emphasized` | `cubic-bezier(.16, 1, .3, 1)` | Things **arriving**. Fast out, soft landing |
| `ease-standard` | `cubic-bezier(.4, 0, .2, 1)` | Things **moving** or resizing. Symmetric |
| `ease-exit` | `cubic-bezier(.4, 0, 1, 1)` | Things **leaving**. Accelerates away |

### Springs

| Token | Stiffness / damping | Use for |
|---|---|---|
| `SPRING_STANDARD` | 400 / 28 | Modals, cards. Settles without overshoot |
| `SPRING_RESPONSIVE` | 416 / 20 | Chips, buttons. Matches a finger tap |
| `SPRING_GENTLE` | 260 / 24 | Presence, decorative. Floats into place |

### Reduced motion

Three separate mechanisms, because no single one reaches everywhere:

1. `globals.css` collapses CSS transitions and animations under
   `@media (prefers-reduced-motion: reduce)`.
2. framer-motion's `MotionConfig reducedMotion="user"` covers every `motion.*` element.
3. **A `requestAnimationFrame` loop is reached by neither.** The WebGL background reads
   the media query itself, renders one static frame, and subscribes to `change` so a
   preference flipped mid-session takes effect without a reload.

If you write a rAF loop, it is your job to handle the third case. Nothing else will.

---

## 9. Control sizing

| Token | Value | Use for |
|---|---|---|
| `h-control-sm` | 36px | Dense toolbars, inline controls |
| `h-control` | **44px** | The default. 44 is the touch threshold |
| `h-control-lg` | 52px | Primary calls to action |
| `tab` | 56px | Phone bottom-bar targets |

Icon sizes: `14 · 16 · 20 · 24 · 32`. Avatar diameters: `20 · 24 · 32 · 48`.

The default control is 44px, not 40, because 44 is the WCAG 2.5.8 enhanced target and
two thirds of this product's interactive elements once measured under 44×44 at 390px.

### The `.touch-target` utility

For a control that must stay visually small — a 32px avatar, a 16px close cross — this
utility paints an invisible 44×44 hit area centred on it, without changing layout:

```css
.touch-target { position: relative }
.touch-target::after {
  content: ""; position: absolute; left: 50%; top: 50%;
  width: max(100%, 44px); height: max(100%, 44px);
  transform: translate(-50%, -50%);
  pointer-events: auto;      /* MUST be explicit — see below */
}
```

Two things will silently defeat it:

- **`pointer-events` is inherited.** Several surfaces here set `none` on a wrapper and
  re-enable it per child; the pseudo-element then inherits `none` and the whole expanded
  area is inert. The explicit `pointer-events: auto` is the fix and must not be removed.
- **`overflow: hidden` on the control clips it.** The pseudo-element extends past the
  element's box, and clipping cuts the hit area straight back to the painted size.

Do **not** use it on controls closer than 8px to a neighbour — the expanded areas would
overlap and steal each other's taps. Those need real spacing.

---

## 10. Accessibility floor

Every one of these is measured across a matrix of 12 routes × 9 viewports × 3 modes
(264 cells) by `docs/ui-audit/tools/live-scan.mjs`, and statically by
`docs/ui-audit/tools/a11y-static.mjs`.

| Criterion | The rule here |
|---|---|
| 1.4.3 Contrast (text) | 4.5:1, or 3:1 at 18.66px+ bold / 24px+. `ink-subtle` is the floor |
| 1.4.11 Non-text contrast | 3:1 for control borders, icons that carry meaning, focus indicators |
| 2.4.7 / 2.4.11 Focus | One indicator, 18.88:1 on paper, with a light halo for dark surfaces |
| 2.5.8 Target size | 24×24 minimum (AA), 44×44 target (ours). Inline links in a sentence are exempt |
| 2.1.1 Keyboard | Everything operable. `tabIndex={-1}` on a real control is a failure |
| 1.3.1 Info and relationships | One `<h1>` per route, no skipped levels, `<main>` on every route |
| 4.1.2 Name, role, value | `title` is **not** an accessible name — it is unannounced by several screen readers and never appears on touch |

### Why the two scanners both exist

`live-scan.mjs` measures what is on screen, which means it only ever sees states the
fixture data produces. An icon button that appears only for the owner of a comment, or
a control inside a menu nobody opened, is invisible to it — that is exactly how eight
`accent-surface`-on-white text colours and three unnamed icon buttons survived a clean
browser sweep. `a11y-static.mjs` reads source, so its coverage does not depend on
reaching a state.

---

## 11. Primitives

| Component | Owns |
|---|---|
| `Button` | Variants, the three control sizes, the `loading` state that blocks re-entry without resizing |
| `Field` | Label↔control association, `aria-describedby`, `aria-invalid`, `role="alert"` on the error |
| `StatusPanel` | Every empty and error state. Two tones, three sizes |
| `Overlay` | Portal, dialog semantics, focus trap, Escape, backdrop dismissal, scroll lock |
| `PriorityMeter` | Priority as filled segments in one ink, plus a spoken name |
| `Avatar` | Image, initials fallback, the optimizer's `sizes` |
| `ConfirmDialog` | Destructive confirmation, with an optional "don't ask again" |
| `Toast` | Transient messages, above the modal layer |

### `Field` — why it takes a render prop

```tsx
<Field label="Email" error={errors.email?.message}>
  {(field) => <input {...field} type="email" autoComplete="email" />}
</Field>
```

The control arrives as a render prop, not as children, so the props carrying the
associations (`id`, `aria-describedby`, `aria-invalid`, `required`) **cannot be silently
dropped** at a call site. Four hand-rolled field wrappers existed before this, each
broken differently and none of it visible on screen: one had no error slot at all, one
rendered the error inside the `<label>` so a screen reader announced
"Email Passwords don't match" as the field's *name*.

### `Overlay` — the Escape phase matters

Escape is listened for in the **bubble** phase. A nested popover registers its own
handler on a deeper node; in the bubble phase that handler runs first and can call
`stopPropagation()` to keep the key. So Escape peels one layer at a time instead of
closing the dialog out from under an open date picker. Capture would invert this and
make the innermost layer unreachable.

The focus trap listens in **capture** for the opposite reason: Tab must be contained no
matter what the content does with it.

### `useScrollLock` — counted, not boolean

A confirm dialog opened from inside the category editor means two overlays are mounted.
If the inner one released the lock on close, scrolling would return while the outer
dialog was still up. The lock lifts only when the last holder releases it, and it
replaces the scrollbar's width as body padding so the page behind does not jump
sideways at the exact moment the dialog appears over it.

---

## 12. Failure modes this system is built against

Each of these shipped. None produced a build error, a type error, or a failing test.

| Failure | How it hides | The guard now |
|---|---|---|
| A Tailwind class that names nothing (`bg-primary-600`, `text-orange-700`) emits no CSS and no error | The element just loses a style. The segment error page's Retry button was white-on-transparent — invisible — on every error page | `docs/ui-audit/tools/class-audit.mjs`, run after a build |
| `tailwind-merge` treats an unrecognised `text-*` as a colour and drops the size | `cn("text-body-sm", "text-ink-subtle")` silently loses `text-body-sm` | `lib/utils.ts` teaches `extendTailwindMerge` every custom scale, read from the token object |
| A `useRef` focus trap on a portalled dialog never engages | The portal mounts a tick late, the effect finds `null` and never re-runs. Every modal shipped with a dead trap while the hook's own tests passed | The hook uses a callback ref backed by state; the portal case is a test |
| `pointer-events` inheritance kills a pseudo-element hit area | The target looks 44×44 to a measuring script and accepts no taps | Explicit `pointer-events: auto`, documented in the utility |
| An opacity modifier on a non-colour utility (`text-center/30`) | Matches nothing. That empty state was never centred | `class-audit.mjs` |
| A shortcut hint inside a button's accessible name | "New Category" announced as "New Category c" | `aria-hidden` on the hint, `aria-keyshortcuts` on the button |
| A codemod rewriting tokens inside CSS value strings | `animation: "… ease-out"` became an invalid `ease-emphasized`; the animation silently stopped | Never run a token codemod over string values without re-running the build and `class-audit.mjs` |

---

## 13. Extending the system

1. **Reach for an existing token first.** A new value needs a reason that names what the
   existing ones cannot express.
2. **Add it to `design-tokens.ts`, nowhere else.** The Tailwind theme is derived; adding
   a value to `tailwind.config.ts` directly re-creates the drift the derivation exists to
   prevent.
3. **Measure the contrast before committing to a colour.** Run
   `node docs/ui-audit/tools/contrast-scan.mjs` and put the figure in the token's comment,
   as every existing colour has.
4. **If it is a colour that is data, mark it `@colour-data`** with the reason, in the file
   that holds it.
5. **Run the gates.**

```bash
cd frontend && npm run build && npx vitest run && node ../docs/ui-audit/tools/class-audit.mjs && node ../docs/ui-audit/tools/a11y-static.mjs
```

---

## See also

- [`frontend.md`](frontend.md) — architecture, patterns and conventions of the frontend
- [`ui-audit/RESEARCH.md`](ui-audit/RESEARCH.md) — the audit these rules came from
- [`ui-audit/DEFECTS.md`](ui-audit/DEFECTS.md) — the defect register, with evidence
- [`ui-audit/TARGET.md`](ui-audit/TARGET.md) — target state, rule by rule
- [`ui-audit/BLUEPRINT.md`](ui-audit/BLUEPRINT.md) — the design blueprint for the whole product
- [`testing.md`](testing.md) — suites, commands, coverage gate

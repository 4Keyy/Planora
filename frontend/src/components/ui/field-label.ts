/**
 * One label style for the whole product.
 *
 * It lives here, and not in `field.tsx`, because `field.tsx` is a `"use client"` module. A
 * server component that imports a constant from a client module does not receive the
 * string — it receives a client reference. Handed straight to `className` that reference
 * happened to render, but through `cn()` it vanished without a trace: every section eyebrow
 * on the landing page (a server component) silently lost its uppercase caption style, for as
 * long as `SectionHead` has existed. A plain module is the same string on both sides.
 *
 * `field.tsx` re-exports it, so client code can keep importing it from there.
 */
export const FIELD_LABEL_CLASS =
  "block text-caption font-semibold uppercase tracking-wider text-ink-muted"

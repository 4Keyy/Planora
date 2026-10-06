/**
 * Whether this tab has already shown a page.
 *
 * Module state, so it lives exactly as long as the client-side app does: false for the
 * first page of a visit, true for every navigation after it. The route templates read it
 * so that only a navigation inside the app animates — the first page of a visit must be
 * in the server HTML fully visible, or it paints blank until hydration (see
 * `app/template.tsx` for the measurement that found this).
 */
let hasShownAPage = false

/** True while rendering the first page of a visit, and always on the server. */
export function isFirstPageOfVisit(): boolean {
  return typeof window === "undefined" || !hasShownAPage
}

/** Called once a page has mounted. */
export function markPageShown(): void {
  hasShownAPage = true
}

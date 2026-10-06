/**
 * Pure helpers for the landing page's reliability-and-privacy block.
 *
 * The block's live proofs read the visitor's own browser — which origins it has contacted,
 * which cookies page scripts can see — and compute a SHA-256 fingerprint on the spot. The
 * reading is done in the component, inside event handlers; the shaping of what was read is
 * here, where it can be tested without a browser.
 */

export interface OriginRow {
  origin: string
  label: "This site" | "Planora's API" | null
}

/**
 * Every distinct http(s) origin in `urls`, this site first, the API second, the rest in
 * alphabetical order. Nothing is hidden: an origin the page talked to is listed whether or
 * not it has a label, because this is live evidence and not a claim.
 */
export function uniqueOrigins(urls: readonly string[], pageOrigin: string, apiOrigin?: string | null): OriginRow[] {
  const seen = new Set<string>()
  for (const url of urls) {
    try {
      const u = new URL(url, pageOrigin)
      if (u.protocol !== "http:" && u.protocol !== "https:") continue
      seen.add(u.origin)
    } catch {
      // Not a URL; nothing to list.
    }
  }
  const rest = [...seen].filter((o) => o !== pageOrigin && o !== apiOrigin).sort()
  const rows: OriginRow[] = []
  if (seen.has(pageOrigin)) rows.push({ origin: pageOrigin, label: "This site" })
  if (apiOrigin && apiOrigin !== pageOrigin && seen.has(apiOrigin)) {
    rows.push({ origin: apiOrigin, label: "Planora's API" })
  }
  for (const origin of rest) rows.push({ origin, label: null })
  return rows
}

/** Cookie NAMES from a `document.cookie` string — never values. Trimmed, deduplicated, in order. */
export function cookieNames(cookieString: string): string[] {
  const names: string[] = []
  for (const pair of cookieString.split(";")) {
    const name = pair.split("=")[0]?.trim() ?? ""
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** "abcdef…uvwxyz" — the ends of a long string, so it fits without pretending to be whole. */
export function truncateMiddle(value: string, keep: number): string {
  if (keep <= 0 || value.length <= keep * 2 + 1) return value
  return `${value.slice(0, keep)}…${value.slice(-keep)}`
}

/** A duration in whole milliseconds, as text. Nonsense reads as zero rather than "NaN". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0"
  return String(Math.round(ms))
}

/** Whole seconds left in a window, for a countdown that must never read below zero. */
export function secondsLeft(windowMs: number, elapsedMs: number): number {
  return Math.max(0, Math.ceil((windowMs - elapsedMs) / 1000))
}

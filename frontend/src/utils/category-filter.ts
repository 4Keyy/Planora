const FILTER_KEY_PREFIX = "todos-cat-filter"
const HINT_KEY = "todos-cat-hint"

function safe<T>(fn: () => T, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try { return fn() } catch { return fallback }
}

/**
 * The category filter is persisted per user so that switching accounts never
 * leaks one user's filter onto another. The key is scoped by userId; without a
 * known user we never read or write a shared key.
 */
function filterKey(userId: string | undefined | null): string | null {
  if (!userId) return null
  return `${FILTER_KEY_PREFIX}:${userId}`
}

export function readFilter(userId: string | undefined | null): string[] {
  const key = filterKey(userId)
  if (!key) return []
  return safe(() => {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  }, [])
}

export function writeFilter(userId: string | undefined | null, ids: string[]): void {
  const key = filterKey(userId)
  if (!key) return
  safe(() => {
    if (ids.length === 0) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(ids))
  }, undefined)
}

export function readHintSeen(): boolean {
  return safe(() => localStorage.getItem(HINT_KEY) === "1", false)
}

export function writeHintSeen(): void {
  safe(() => localStorage.setItem(HINT_KEY, "1"), undefined)
}

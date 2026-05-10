const FILTER_KEY = "todos-cat-filter"
const HINT_KEY = "todos-cat-hint"

function safe<T>(fn: () => T, fallback: T): T {
  if (typeof window === "undefined") return fallback
  try { return fn() } catch { return fallback }
}

export function readFilter(): string[] {
  return safe(() => {
    const raw = localStorage.getItem(FILTER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  }, [])
}

export function writeFilter(ids: string[]): void {
  safe(() => {
    if (ids.length === 0) localStorage.removeItem(FILTER_KEY)
    else localStorage.setItem(FILTER_KEY, JSON.stringify(ids))
  }, undefined)
}

export function readHintSeen(): boolean {
  return safe(() => localStorage.getItem(HINT_KEY) === "1", false)
}

export function writeHintSeen(): void {
  safe(() => localStorage.setItem(HINT_KEY, "1"), undefined)
}

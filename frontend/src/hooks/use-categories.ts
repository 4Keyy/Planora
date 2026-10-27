"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import axios from "axios"
import { api, parseApiResponse, type ApiResponse } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { toCategoryList, type Category, type CategoryListResponse } from "@/types/category"

/**
 * The viewer's categories, read once and shared by every screen that offers them — New task, the
 * task editor, a task's page, the archive and the command palette.
 *
 * Each of those used to read the list on its own when its page mounted, and swallowed a failure:
 * a read that lost a race with the session restore or met a 429 left New task with no categories
 * until the page was reloaded, while its title, priority and date fields worked. Here one read
 * serves everyone, it starts the moment the session is restored rather than when a page gets round
 * to it, a transient failure (no connection, 429, 5xx) is retried on its own, and opening New task
 * asks again if the list is missing or old. Like the friend list (`use-friends.ts`) it is kept in
 * memory only, per account; a write elsewhere marks it stale and the next read refreshes it while
 * the old list stays on screen.
 */

const URL = "/categories/api/v1/categories"
/** A list younger than this is served as it is; an older one is shown and read again. */
const TTL_MS = 60_000
/** Waits before each retry of a transient failure. */
const RETRY_DELAYS_MS = [600, 1_500, 4_000] as const
/** The longest a 429's Retry-After may hold a retry back; past it the next open asks again. */
const MAX_RETRY_AFTER_MS = 10_000

const EMPTY: Category[] = []

type Entry = { userId: string; value: Category[]; at: number }

let entry: Entry | null = null
let inflight: { userId: string; promise: Promise<Category[]> } | null = null
const listeners = new Set<() => void>()

const viewerId = () => useAuthStore.getState().user?.userId ?? null

function publish(next: Entry | null) {
  entry = next
  for (const listener of listeners) listener()
}

const isValid = (c: Category | null | undefined): c is Category =>
  Boolean(c?.id) && typeof c?.name === "string" && c.name.trim() !== ""

/** How long to wait before retrying `error`, or null when retrying cannot help. */
function retryDelay(error: unknown, attempt: number): number | null {
  if (attempt >= RETRY_DELAYS_MS.length) return null
  if (axios.isCancel(error)) return null
  if (!axios.isAxiosError(error)) return null
  const status = error.response?.status
  if (status === undefined) return RETRY_DELAYS_MS[attempt]
  if (status === 429) {
    const header = Number(error.response?.headers?.["retry-after"])
    const after = Number.isFinite(header) && header > 0 ? header * 1000 : RETRY_DELAYS_MS[attempt]
    return after <= MAX_RETRY_AFTER_MS ? after : null
  }
  return status >= 500 ? RETRY_DELAYS_MS[attempt] : null
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function fetchCategories(): Promise<Category[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await api.get<ApiResponse<CategoryListResponse>>(URL)
      return toCategoryList(parseApiResponse<CategoryListResponse>(res.data)).filter(isValid)
    } catch (error) {
      const delay = retryDelay(error, attempt)
      if (delay === null) throw error
      await wait(delay)
    }
  }
}

/** Reads the list for the signed-in viewer, sharing a read already on its way. */
function load(force = false): Promise<Category[]> {
  const userId = viewerId()
  if (!userId) return Promise.resolve(EMPTY)
  if (entry && entry.userId !== userId) publish(null)
  if (!force && entry && Date.now() - entry.at < TTL_MS) return Promise.resolve(entry.value)
  if (inflight && inflight.userId === userId) return inflight.promise

  const promise = fetchCategories()
    .then((value) => {
      // A sign-out or another account while the read was out: its answer belongs to nobody.
      if (viewerId() === userId) publish({ userId, value, at: Date.now() })
      return value
    })
    .finally(() => {
      if (inflight?.promise === promise) inflight = null
    })
  inflight = { userId, promise }
  return promise
}

/**
 * The list, from memory when it is fresh. Rejects only when every retry failed; the next call
 * tries again. For non-React readers such as the command palette.
 */
export function getCachedCategories(): Promise<Category[]> {
  return load()
}

/**
 * Makes sure a list is on its way: nothing when a fresh one is held, a read when it is missing,
 * old or failed last time. Never rejects — callers fire it when they are about to need the list.
 */
export function ensureCategories(): void {
  void load().catch(() => undefined)
}

/** Reads the list again now, after a category was created, changed or deleted. */
export function reloadCategories(): Promise<Category[]> {
  return load(true)
}

/** Marks the list stale: whoever reads it next sees the old one while it is read again. */
export function invalidateCategories(): void {
  if (entry) entry = { ...entry, at: 0 }
}

/** Hands the cache a list read elsewhere (the Categories screen reads its own, with counts). */
export function setCachedCategories(value: Category[]): void {
  const userId = viewerId()
  if (!userId) return
  publish({ userId, value: value.filter(isValid), at: Date.now() })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => {
  const userId = viewerId()
  return entry && userId && entry.userId === userId ? entry.value : EMPTY
}
const serverSnapshot = () => EMPTY

// The read starts as soon as the session is restored, before any page mounts; a sign-out drops
// the list so the next account never sees it.
if (typeof window !== "undefined") {
  useAuthStore.subscribe((state, previous) => {
    const userId = state.user?.userId ?? null
    if (!state.isAuthenticated || !userId) {
      if (entry) publish(null)
      return
    }
    const ready = state.hasRestoredSession && Boolean(state.accessToken)
    const wasReady =
      previous.isAuthenticated && previous.hasRestoredSession && Boolean(previous.accessToken) &&
      (previous.user?.userId ?? null) === userId
    if (ready && !wasReady) ensureCategories()
  })
}

export interface CategoriesState {
  categories: Category[]
  /** Reads the list again now; resolves when it is in (or the read failed). */
  reload: () => Promise<void>
}

/**
 * The viewer's categories for a screen. `enabled` is the screen's "signed in and ready"; while
 * it holds, a missing or old list is read (the held one stays on screen meanwhile).
 */
export function useCategories(enabled: boolean): CategoriesState {
  const categories = useSyncExternalStore(subscribe, snapshot, serverSnapshot)

  useEffect(() => {
    if (enabled) ensureCategories()
  }, [enabled])

  const reload = useCallback(async () => {
    try {
      await reloadCategories()
    } catch {
      // The list on screen stays; the next open of New task asks again.
    }
  }, [])

  return { categories, reload }
}

/** Test seam: forget everything between tests. */
export function resetCategoriesCache(): void {
  entry = null
  inflight = null
  for (const listener of listeners) listener()
}

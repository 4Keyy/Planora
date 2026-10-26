"use client"

import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import type { FriendDto, PagedResult } from "@/types/auth"

// The friend list is read by several components (the create panel, the edit modal, pickers) and
// barely changes within a session, yet each mount used to re-page the whole list (pageSize 200) — and
// React StrictMode double-fires effects in dev — so opening a modal a few times could blow past the
// per-user /friendships rate limit (429). Share one fetch across all consumers: a short-lived cache
// serves repeat reads instantly, concurrent callers await a single in-flight request, and friend
// mutations call invalidateFriends() to force the next read to refetch.
const TTL_MS = 60_000

let cache: { value: FriendDto[]; at: number } | null = null
let inflight: Promise<FriendDto[]> | null = null

/** The server's largest page (`PaginationParameters.MaxPageSize`); it clamps any larger request. */
const PAGE_SIZE = 100
/** A backstop against a server that never says it is done: 5,000 friends. */
const PAGE_LIMIT = 50

async function fetchAllFriends(): Promise<FriendDto[]> {
  const byId = new Map<string, FriendDto>()
  let page = 1

  while (true) {
    const res = await api.get<PagedResult<FriendDto>>("/friendships", {
      params: { pageNumber: page, pageSize: PAGE_SIZE },
    })
    const data = res.data
    const items = data?.items ?? []
    // A friendship accepted while the pages load can shift a friend across a page boundary; keep
    // each friend once.
    for (const friend of items) byId.set(friend.id, friend)
    // The server says when it is done; a page shorter than the size it applied is the last one too.
    if (!data?.hasNextPage || items.length < (data.pageSize || PAGE_SIZE)) break
    page++
    if (page > PAGE_LIMIT) break
  }

  return [...byId.values()]
}

function loadFriends(): Promise<FriendDto[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value)
  if (inflight) return inflight

  inflight = fetchAllFriends()
    .then((value) => {
      cache = { value, at: Date.now() }
      return value
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

/**
 * Drop the cached friend list so the next {@link useFriends} read refetches. Call after any mutation
 * that changes the caller's friends (accepting/rejecting a request, removing a friend).
 */
export function invalidateFriends(): void {
  cache = null
  inflight = null
}

/**
 * Resolve the caller's friend list through the same shared cache {@link useFriends} reads — warm
 * reads are instant and concurrent callers await one request. For non-React consumers (e.g. name
 * resolution) so they never open a second, independent /friendships paging loop.
 */
export function getCachedFriends(): Promise<FriendDto[]> {
  return loadFriends()
}

export function useFriends(enabled: boolean): FriendDto[] {
  const [friends, setFriends] = useState<FriendDto[]>(() => cache?.value ?? [])

  useEffect(() => {
    if (!enabled) return
    let active = true

    loadFriends()
      .then((value) => {
        if (active) setFriends(value)
      })
      .catch(() => {
        // Silent fail — friends list falls back to whatever is cached (or empty).
      })

    return () => {
      active = false
    }
  }, [enabled])

  return friends
}

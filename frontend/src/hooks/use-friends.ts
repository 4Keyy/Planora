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

async function fetchAllFriends(): Promise<FriendDto[]> {
  const collected: FriendDto[] = []
  let page = 1
  const pageSize = 200

  while (true) {
    const res = await api.get<PagedResult<FriendDto>>("/friendships", {
      params: { pageNumber: page, pageSize },
    })
    const data = res.data
    const items = data?.items ?? []
    collected.push(...items)
    if (!data?.hasNextPage || items.length < pageSize) break
    page++
    if (page > 50) break
  }

  return collected
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

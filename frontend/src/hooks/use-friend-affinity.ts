"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { FriendAffinity } from "@/lib/audience-map"

/**
 * How close each friend is — `GET /todos/api/v1/todos/friend-affinity` — for the audience map,
 * which seats the friends you share the most with nearest to you.
 *
 * Read the way {@link useFriends} reads the friend list: one short-lived cache shared by every
 * map on screen, and one request in flight however many ask. A server without the endpoint, or a
 * failed read, leaves the map empty and every friend at no history — the map then orders them by
 * name, which is still a stable place for everyone.
 */
const TTL_MS = 60_000
const EMPTY: ReadonlyMap<string, FriendAffinity> = new Map()

let cache: { value: ReadonlyMap<string, FriendAffinity>; at: number } | null = null
let inflight: Promise<ReadonlyMap<string, FriendAffinity>> | null = null

function loadAffinity(): Promise<ReadonlyMap<string, FriendAffinity>> {
  if (cache && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.value)
  if (inflight) return inflight
  inflight = Promise.resolve()
    .then(() => api.get<FriendAffinity[]>("/todos/api/v1/todos/friend-affinity"))
    .then((res) => {
      const rows = Array.isArray(res?.data) ? res.data : []
      const value: ReadonlyMap<string, FriendAffinity> = new Map(rows.map((entry) => [entry.friendId, entry] as const))
      cache = { value, at: Date.now() }
      return value
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Drop the cached closeness, so the next read asks again — after a share changes, for one. */
export function invalidateFriendAffinity(): void {
  cache = null
  inflight = null
}

export function useFriendAffinity(enabled: boolean): ReadonlyMap<string, FriendAffinity> {
  const [affinity, setAffinity] = useState<ReadonlyMap<string, FriendAffinity>>(() => cache?.value ?? EMPTY)

  useEffect(() => {
    if (!enabled) return
    let active = true
    loadAffinity()
      .then((value) => {
        if (active) setAffinity(value)
      })
      .catch(() => {
        // No closeness to order by: the map falls back to names.
      })
    return () => {
      active = false
    }
  }, [enabled])

  return affinity
}

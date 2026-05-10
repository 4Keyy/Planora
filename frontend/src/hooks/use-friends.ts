"use client"

import { useState, useEffect } from "react"
import { api } from "@/lib/api"
import type { FriendDto, PagedResult } from "@/types/auth"

export function useFriends(enabled: boolean): FriendDto[] {
  const [friends, setFriends] = useState<FriendDto[]>([])

  useEffect(() => {
    if (!enabled || friends.length > 0) return
    let active = true

    const load = async () => {
      try {
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

        if (active) setFriends(collected)
      } catch {
        // Silent fail — friends list falls back to empty
      }
    }

    load()
    return () => {
      active = false
    }
  }, [enabled, friends.length])

  return friends
}

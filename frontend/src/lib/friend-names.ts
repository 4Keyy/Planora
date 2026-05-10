import { api, parseApiResponse } from "@/lib/api"
import type { FriendDto, PagedResult } from "@/types/auth"

const formatFriendName = (friend: FriendDto) => {
  const fullName = [friend.firstName, friend.lastName].filter(Boolean).join(" ").trim()
  if (fullName) return fullName
  if (friend.email) return friend.email.split("@")[0]
  return "Friend"
}

export const ensureFriendNames = async (
  neededIds: Set<string>,
  cache: Map<string, string>
) => {
  if (neededIds.size === 0) return

  const missingIds = new Set<string>()
  neededIds.forEach((id) => {
    if (!cache.has(id)) missingIds.add(id)
  })

  if (missingIds.size === 0) return

  let page = 1
  const pageSize = 200
  let safety = 0

  try {
    while (missingIds.size > 0) {
      const res = await api.get<PagedResult<FriendDto>>("/friendships", {
        params: { pageNumber: page, pageSize },
      })
      const data = parseApiResponse<PagedResult<FriendDto>>(res.data)
      const items = data?.items ?? []

      for (const friend of items) {
        cache.set(friend.id, formatFriendName(friend))
        missingIds.delete(friend.id)
      }

      const hasNextPage =
        typeof data?.hasNextPage === "boolean"
          ? data.hasNextPage
          : items.length === pageSize

      if (!hasNextPage || items.length === 0) break

      page += 1
      safety += 1
      if (safety > 50) break
    }
  } catch {
    // Silent fail: fallback to default label in UI
  }
}

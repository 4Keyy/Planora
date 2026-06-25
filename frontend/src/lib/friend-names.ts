import { getCachedFriends } from "@/hooks/use-friends"
import type { FriendDto } from "@/types/auth"

const formatFriendName = (friend: FriendDto) => {
  const fullName = [friend.firstName, friend.lastName].filter(Boolean).join(" ").trim()
  if (fullName) return fullName
  if (friend.email) return friend.email.split("@")[0]
  return "Friend"
}

/**
 * Fill `cache` (id → display name) for any ids in `neededIds` it does not already hold, resolving
 * names from the shared friend cache (see {@link getCachedFriends}) rather than opening a second
 * /friendships paging loop. A lookup failure is swallowed so the UI falls back to a default label.
 */
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

  try {
    const friends = await getCachedFriends()
    for (const friend of friends) {
      if (missingIds.has(friend.id)) {
        cache.set(friend.id, formatFriendName(friend))
      }
    }
  } catch {
    // Silent fail: fallback to default label in UI
  }
}

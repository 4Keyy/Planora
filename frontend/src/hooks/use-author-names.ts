"use client"

import { useCallback, useMemo, useRef } from "react"
import { ensureFriendNames } from "@/lib/friend-names"
import { sameUserId, type Todo } from "@/types/todo"

/** A friend's task the viewer may see — public or shared — whose author has a name to show. */
const isFriendsVisibleTask = (todo: Todo, viewerId: string) =>
  !!todo.userId && !sameUserId(todo.userId, viewerId) && (todo.isPublic || (todo.sharedWithUserIds?.length ?? 0) > 0)

export interface AuthorNames {
  /**
   * The tasks with their authors' names on friends' public and shared tasks, each friend's name
   * read once for the page's life (`ensureFriendNames`). The viewer's own tasks come back as they
   * were, and so does everything while no name is known.
   */
  enrich: (items: Todo[]) => Promise<Todo[]>
  /** A name already read, for a task the page updates in place. */
  nameOf: (userId: string) => string | undefined
}

/**
 * Friends' names on a page's tasks (audit FE-24). Dashboard, Tasks and the archive each carried a
 * copy of this, and Dashboard's told the viewer's own tasks apart with an exact `===` where the
 * others used `sameUserId`. The names are kept per page, as they were.
 */
export function useAuthorNames(viewerId: string | null | undefined): AuthorNames {
  const names = useRef<Map<string, string>>(new Map())

  const enrich = useCallback(async (items: Todo[]) => {
    if (!viewerId) return items
    const friendIds = new Set(items.filter((t) => isFriendsVisibleTask(t, viewerId)).map((t) => t.userId))
    if (friendIds.size === 0) return items

    await ensureFriendNames(friendIds, names.current)
    if (names.current.size === 0) return items

    return items.map((t) => {
      if (!isFriendsVisibleTask(t, viewerId)) return t
      const authorName = names.current.get(t.userId)
      return authorName ? { ...t, authorName } : t
    })
  }, [viewerId])

  const nameOf = useCallback((userId: string) => names.current.get(userId), [])

  return useMemo(() => ({ enrich, nameOf }), [enrich, nameOf])
}

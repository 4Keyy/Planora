import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useFriends } from "@/hooks/use-friends"
import { api } from "@/lib/api"
import type { FriendDto, PagedResult } from "@/types/auth"

const friend = (id: string): FriendDto => ({
  id,
  email: `${id}@example.com`,
  firstName: "First",
  lastName: "Last",
  friendsSince: "2026-05-01T00:00:00.000Z",
})

const page = (items: FriendDto[], hasNextPage = false): PagedResult<FriendDto> => ({
  items,
  pageNumber: 1,
  pageSize: 200,
  totalCount: items.length,
  totalPages: hasNextPage ? 2 : 1,
  hasPreviousPage: false,
  hasNextPage,
})

describe("useFriends", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("does not load when disabled", () => {
    const get = vi.spyOn(api, "get")

    const { result } = renderHook(() => useFriends(false))

    expect(result.current).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  it("loads friends across pages when enabled", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => friend(`friend-${index + 1}`))
    vi.spyOn(api, "get")
      .mockResolvedValueOnce({ data: page(firstPage, true) })
      .mockResolvedValueOnce({ data: page([friend("friend-201")]) })

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(result.current).toHaveLength(201))
    expect(result.current[0].id).toBe("friend-1")
    expect(result.current[200].id).toBe("friend-201")
  })

  it("silently falls back to an empty list when loading fails", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"))

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })
})

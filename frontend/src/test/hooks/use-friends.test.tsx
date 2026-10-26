import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useFriends, invalidateFriends } from "@/hooks/use-friends"
import { api } from "@/lib/api"
import type { FriendDto, PagedResult } from "@/types/auth"

const friend = (id: string): FriendDto => ({
  id,
  email: `${id}@example.com`,
  firstName: "First",
  lastName: "Last",
  friendsSince: "2026-05-01T00:00:00.000Z",
})

// The server applies at most 100 rows a page (PaginationParameters.MaxPageSize) and says so.
const page = (items: FriendDto[], hasNextPage = false, pageSize = 100): PagedResult<FriendDto> => ({
  items,
  pageNumber: 1,
  pageSize,
  totalCount: items.length,
  totalPages: hasNextPage ? 2 : 1,
  hasPreviousPage: false,
  hasNextPage,
})

describe("useFriends", () => {
  afterEach(() => {
    invalidateFriends() // reset the shared module cache so tests stay isolated
    vi.restoreAllMocks()
  })

  it("does not load when disabled", () => {
    const get = vi.spyOn(api, "get")

    const { result } = renderHook(() => useFriends(false))

    expect(result.current).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  it("loads friends across pages when enabled", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => friend(`friend-${index + 1}`))
    const secondPage = Array.from({ length: 100 }, (_, index) => friend(`friend-${index + 101}`))
    const get = vi.spyOn(api, "get")
      .mockResolvedValueOnce({ data: page(firstPage, true) })
      .mockResolvedValueOnce({ data: page(secondPage, true) })
      .mockResolvedValueOnce({ data: page([friend("friend-201")]) })

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(result.current).toHaveLength(201))
    expect(result.current[0].id).toBe("friend-1")
    expect(result.current[200].id).toBe("friend-201")
    expect(get.mock.calls.map(([, config]) => (config as { params: unknown }).params)).toEqual([
      { pageNumber: 1, pageSize: 100 },
      { pageNumber: 2, pageSize: 100 },
      { pageNumber: 3, pageSize: 100 },
    ])
  })

  // FE-11 (API-14): the hook asked for 200 a page and stopped at the first page shorter than 200 —
  // but the server answers at most 100, so everyone after the hundredth friend was missing.
  it("keeps paging while the server reports more, at the page size it applied", async () => {
    const full = Array.from({ length: 100 }, (_, index) => friend(`friend-${index + 1}`))
    vi.spyOn(api, "get")
      .mockResolvedValueOnce({ data: page(full, true) })
      .mockResolvedValueOnce({ data: page([friend("friend-101")]) })

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(result.current).toHaveLength(101))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it("keeps a friend once when a page boundary shifts while loading", async () => {
    const full = Array.from({ length: 100 }, (_, index) => friend(`friend-${index + 1}`))
    vi.spyOn(api, "get")
      .mockResolvedValueOnce({ data: page(full, true) })
      .mockResolvedValueOnce({ data: page([friend("friend-100"), friend("friend-101")]) })

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(result.current).toHaveLength(101))
    expect(new Set(result.current.map((f) => f.id)).size).toBe(101)
  })

  it("stops paging when a page returns fewer items than the page size", async () => {
    // The page claims a next page but is shorter than pageSize — the
    // short-page guard must stop the loop after the first request.
    vi.spyOn(api, "get").mockResolvedValueOnce({ data: page([friend("only")], true) })

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(api.get).toHaveBeenCalledTimes(1)
  })

  it("treats a missing items array as an empty page", async () => {
    vi.spyOn(api, "get").mockResolvedValueOnce({ data: { ...page([]), items: undefined } })

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })

  it("silently falls back to an empty list when loading fails", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"))

    const { result } = renderHook(() => useFriends(true))

    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(result.current).toEqual([])
  })
})

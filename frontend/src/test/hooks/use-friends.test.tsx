import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useFriends, invalidateFriends, getCachedFriends } from "@/hooks/use-friends"
import { useAuthStore } from "@/store/auth"
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
    useAuthStore.setState({ user: undefined })
    vi.restoreAllMocks()
  })

  it("does not load when disabled", () => {
    const get = vi.spyOn(api, "get")

    const { result } = renderHook(() => useFriends(false))

    expect(result.current).toEqual([])
    expect(get).not.toHaveBeenCalled()
  })

  const account = (userId: string) => {
    useAuthStore.setState({ user: { userId, email: `${userId}@example.test`, firstName: "User", lastName: "Test" } })
  }

  it("never renders a previous account's cached friends during an account switch", async () => {
    account("first")
    vi.spyOn(api, "get").mockResolvedValueOnce({ data: page([friend("private-first")]) })
      .mockImplementationOnce(() => new Promise(() => {}))
    const { result } = renderHook(() => useFriends(true))
    await waitFor(() => expect(result.current[0]?.id).toBe("private-first"))

    act(() => account("second"))
    expect(result.current).toEqual([])
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2))
  })

  it("discards an old account's pending response without clearing the new request", async () => {
    account("first")
    let finishFirst!: (value: { data: PagedResult<FriendDto> }) => void
    let finishSecond!: (value: { data: PagedResult<FriendDto> }) => void
    const get = vi.spyOn(api, "get")
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
    const first = getCachedFriends()
    account("second")
    const second = getCachedFriends()
    expect(get).toHaveBeenCalledTimes(2)
    finishFirst({ data: page([friend("private-first")]) })
    await expect(first).resolves.toEqual([])
    expect(getCachedFriends()).toBe(second)
    finishSecond({ data: page([friend("private-second")]) })
    await expect(second).resolves.toEqual([friend("private-second")])
    await expect(getCachedFriends()).resolves.toEqual([friend("private-second")])
  })

  it("does not repopulate an explicitly invalidated cache with a stale result", async () => {
    let finish!: (value: { data: PagedResult<FriendDto> }) => void
    const get = vi.spyOn(api, "get")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
      .mockResolvedValueOnce({ data: page([friend("fresh")]) })
    const old = getCachedFriends()
    invalidateFriends()
    finish({ data: page([friend("stale")]) })
    await expect(old).resolves.toEqual([])
    await expect(getCachedFriends()).resolves.toEqual([friend("fresh")])
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("does not deliver a warm cache after the account changes", async () => {
    account("first")
    vi.spyOn(api, "get").mockResolvedValue({ data: page([friend("private-first")]) })
    await getCachedFriends()
    const warm = getCachedFriends()
    account("second")
    await expect(warm).resolves.toEqual([])
  })

  it("invalidates a warm read across logout and login even to the same viewer", async () => {
    account("first")
    vi.spyOn(api, "get").mockResolvedValue({ data: page([friend("private-first")]) })
    await getCachedFriends()
    const warm = getCachedFriends()
    useAuthStore.setState({ user: undefined })
    account("first")
    await expect(warm).resolves.toEqual([])
  })

  it("stops paging if the account changes while a page is pending", async () => {
    account("first")
    let finish!: (value: { data: PagedResult<FriendDto> }) => void
    const get = vi.spyOn(api, "get")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const pending = getCachedFriends()
    account("second")
    finish({ data: page(Array.from({ length: 100 }, (_, i) => friend(String(i))), true) })
    await expect(pending).resolves.toEqual([])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("clears visible friends on logout and does not initialize a disabled hook from cache", async () => {
    account("first")
    vi.spyOn(api, "get").mockResolvedValue({ data: page([friend("private")]) })
    const { result } = renderHook(() => useFriends(true))
    await waitFor(() => expect(result.current[0]?.id).toBe("private"))
    expect(renderHook(() => useFriends(false)).result.current).toEqual([])
    act(() => useAuthStore.setState({ user: undefined }))
    expect(result.current).toEqual([])
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

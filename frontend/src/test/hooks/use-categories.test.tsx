import { act, renderHook, waitFor } from "@testing-library/react"
import { AxiosError, AxiosHeaders } from "axios"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const get = vi.fn()

vi.mock("@/lib/api", () => ({
  api: { get: (...args: unknown[]) => get(...args) },
  parseApiResponse: <T,>(response: T) => response,
}))

import { useAuthStore } from "@/store/auth"
import {
  ensureCategories,
  getCachedCategories,
  invalidateCategories,
  reloadCategories,
  resetCategoriesCache,
  setCachedCategories,
  useCategories,
} from "@/hooks/use-categories"

const HOME = { id: "c-home", name: "Home", color: "#3B82F6", icon: "Home" }
const WORK = { id: "c-work", name: "Work", color: "#10B981", icon: "Briefcase" }

const ok = (items: unknown[]) => ({ data: { items } })
const failure = (status?: number, headers: Record<string, string> = {}) =>
  new AxiosError(
    "failed",
    status ? "ERR_BAD_RESPONSE" : "ERR_NETWORK",
    undefined,
    undefined,
    status
      ? { status, statusText: "", headers, config: { headers: new AxiosHeaders() }, data: {} }
      : undefined,
  )

const signIn = (userId = "me") =>
  useAuthStore.setState({
    isAuthenticated: true,
    hasRestoredSession: true,
    accessToken: `token-${userId}`,
    user: { userId, email: `${userId}@example.test`, firstName: "Me", lastName: "Self" },
  })

beforeEach(() => {
  get.mockReset()
  useAuthStore.setState({ isAuthenticated: false, hasRestoredSession: false, accessToken: undefined, user: undefined })
  resetCategoriesCache()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("use-categories", () => {
  it("reads once for every screen that asks at the same time", async () => {
    get.mockResolvedValue(ok([HOME]))
    signIn()
    get.mockClear()

    const first = renderHook(() => useCategories(true))
    const second = renderHook(() => useCategories(true))

    await waitFor(() => expect(first.result.current.categories).toEqual([HOME]))
    expect(second.result.current.categories).toEqual([HOME])
    expect(get).toHaveBeenCalledTimes(0)
  })

  it("starts reading the moment the session is restored, before any screen mounts", async () => {
    get.mockResolvedValue(ok([HOME, WORK]))

    signIn()

    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith("/categories/api/v1/categories")
    await expect(getCachedCategories()).resolves.toEqual([HOME, WORK])
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("retries a lost connection and a 5xx on its own", async () => {
    vi.useFakeTimers()
    get.mockRejectedValueOnce(failure()).mockRejectedValueOnce(failure(503)).mockResolvedValueOnce(ok([HOME]))

    signIn()
    const read = getCachedCategories()
    await vi.runAllTimersAsync()

    await expect(read).resolves.toEqual([HOME])
    expect(get).toHaveBeenCalledTimes(3)
  })

  it("waits out a 429 for as long as Retry-After says", async () => {
    vi.useFakeTimers()
    get.mockRejectedValueOnce(failure(429, { "retry-after": "3" })).mockResolvedValueOnce(ok([WORK]))

    signIn()
    const read = getCachedCategories()
    await vi.advanceTimersByTimeAsync(2_900)
    expect(get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(200)

    await expect(read).resolves.toEqual([WORK])
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("does not retry what retrying cannot fix, and asks again on the next open", async () => {
    get.mockRejectedValueOnce(failure(403))
    signIn()
    await expect(getCachedCategories()).rejects.toBeInstanceOf(AxiosError)
    expect(get).toHaveBeenCalledTimes(1)

    get.mockResolvedValueOnce(ok([HOME]))
    const { result } = renderHook(() => useCategories(true))
    ensureCategories()

    await waitFor(() => expect(result.current.categories).toEqual([HOME]))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it("keeps the old list on screen while a stale one is read again", async () => {
    get.mockResolvedValueOnce(ok([HOME]))
    signIn()
    await getCachedCategories()

    let resolve: (value: unknown) => void = () => undefined
    get.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    invalidateCategories()
    const { result } = renderHook(() => useCategories(true))

    expect(result.current.categories).toEqual([HOME])
    await act(async () => resolve(ok([HOME, WORK])))
    await waitFor(() => expect(result.current.categories).toEqual([HOME, WORK]))
  })

  it("reload reads now and tells every screen", async () => {
    get.mockResolvedValueOnce(ok([HOME]))
    signIn()
    await getCachedCategories()
    const { result } = renderHook(() => useCategories(true))

    get.mockResolvedValueOnce(ok([HOME, WORK]))
    await act(() => result.current.reload())

    expect(result.current.categories).toEqual([HOME, WORK])
    expect(get).toHaveBeenCalledTimes(2)

    get.mockResolvedValueOnce(ok([WORK]))
    await act(async () => { await reloadCategories() })
    expect(result.current.categories).toEqual([WORK])
  })

  it("takes a list read elsewhere, dropping rows without a name", async () => {
    get.mockResolvedValue(ok([]))
    signIn()
    const { result } = renderHook(() => useCategories(true))

    act(() => setCachedCategories([WORK, { id: "c-blank", name: "  " }]))

    expect(result.current.categories).toEqual([WORK])
  })

  it("forgets the list on sign-out and never shows it to the next account", async () => {
    get.mockResolvedValueOnce(ok([HOME]))
    signIn("me")
    const { result } = renderHook(() => useCategories(true))
    await waitFor(() => expect(result.current.categories).toEqual([HOME]))

    act(() => useAuthStore.setState({ isAuthenticated: false, accessToken: undefined, user: undefined }))
    expect(result.current.categories).toEqual([])

    get.mockResolvedValueOnce(ok([WORK]))
    act(() => signIn("someone-else"))
    await waitFor(() => expect(result.current.categories).toEqual([WORK]))
  })
})

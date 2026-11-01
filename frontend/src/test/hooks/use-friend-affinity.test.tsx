import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useFriendAffinity, invalidateFriendAffinity } from "@/hooks/use-friend-affinity"
import { useAuthStore } from "@/store/auth"
import { api } from "@/lib/api"

const account = (userId: string) => useAuthStore.setState({
  user: { userId, email: `${userId}@example.test`, firstName: "User", lastName: "Test" },
})
const row = (friendId: string) => ({ friendId, score: 2, sharedByMe: 1, sharedWithMe: 1 })

describe("useFriendAffinity session isolation", () => {
  afterEach(() => {
    invalidateFriendAffinity()
    useAuthStore.setState({ user: undefined })
    vi.restoreAllMocks()
  })

  it("hides cached affinity immediately when the viewer changes", async () => {
    account("first")
    const get = vi.spyOn(api, "get").mockResolvedValueOnce({ data: [row("private-first")] })
      .mockImplementationOnce(() => new Promise(() => {}))
    const { result } = renderHook(() => useFriendAffinity(true))
    await waitFor(() => expect(result.current.has("private-first")).toBe(true))
    act(() => account("second"))
    expect(result.current.size).toBe(0)
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
  })

  it("discards an old account's response while the new read remains shared", async () => {
    account("first")
    let finishFirst!: (value: { data: ReturnType<typeof row>[] }) => void
    let finishSecond!: (value: { data: ReturnType<typeof row>[] }) => void
    const get = vi.spyOn(api, "get")
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = resolve }))
    const { result } = renderHook(() => useFriendAffinity(true))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
    act(() => account("second"))
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await act(async () => { finishFirst({ data: [row("private-first")] }) })
    expect(result.current.size).toBe(0)
    renderHook(() => useFriendAffinity(true))
    expect(get).toHaveBeenCalledTimes(2)
    await act(async () => { finishSecond({ data: [row("private-second")] }) })
    await waitFor(() => expect(result.current.has("private-second")).toBe(true))
    expect(result.current.has("private-first")).toBe(false)
  })

  it("does not expose a warm cache while disabled or after logout", async () => {
    account("first")
    vi.spyOn(api, "get").mockResolvedValue({ data: [row("private")] })
    const { result } = renderHook(() => useFriendAffinity(true))
    await waitFor(() => expect(result.current.size).toBe(1))
    expect(renderHook(() => useFriendAffinity(false)).result.current.size).toBe(0)
    act(() => useAuthStore.setState({ user: undefined }))
    expect(result.current.size).toBe(0)
  })
})

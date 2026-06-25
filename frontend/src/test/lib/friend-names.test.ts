import { afterEach, describe, expect, it, vi } from "vitest"
import { ensureFriendNames } from "@/lib/friend-names"
import { invalidateFriends } from "@/hooks/use-friends"
import { api } from "@/lib/api"
import type { FriendDto, PagedResult } from "@/types/auth"

const friend = (overrides: Partial<FriendDto>): FriendDto => ({
  id: "friend-1",
  email: "friend@example.com",
  firstName: "First",
  lastName: "Last",
  friendsSince: "2026-05-01T00:00:00.000Z",
  ...overrides,
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

describe("ensureFriendNames", () => {
  afterEach(() => {
    invalidateFriends() // reset the shared friend cache so tests stay isolated
    vi.restoreAllMocks()
  })

  it("does nothing when there are no requested ids", async () => {
    const get = vi.spyOn(api, "get")

    await ensureFriendNames(new Set(), new Map())

    expect(get).not.toHaveBeenCalled()
  })

  it("does not fetch ids that are already cached", async () => {
    const get = vi.spyOn(api, "get")
    const cache = new Map([["friend-1", "Cached Name"]])

    await ensureFriendNames(new Set(["friend-1"]), cache)

    expect(cache.get("friend-1")).toBe("Cached Name")
    expect(get).not.toHaveBeenCalled()
  })

  it("loads friend names from the shared cache and formats full-name/email fallbacks", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: page([
        friend({ id: "friend-1", firstName: "Ada", lastName: "Lovelace" }),
        friend({ id: "friend-2", email: "grace@example.com", firstName: "", lastName: "" }),
        friend({ id: "friend-3", email: "", firstName: "", lastName: "" }),
      ]),
    })
    const cache = new Map<string, string>()

    await ensureFriendNames(new Set(["friend-1", "friend-2", "friend-3"]), cache)

    expect(cache.get("friend-1")).toBe("Ada Lovelace")
    expect(cache.get("friend-2")).toBe("grace")
    expect(cache.get("friend-3")).toBe("Friend")
  })

  it("reuses the shared cache instead of re-fetching for a second resolution", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue({
      data: page([friend({ id: "friend-1", firstName: "Ada", lastName: "" })]),
    })

    await ensureFriendNames(new Set(["friend-1"]), new Map())
    await ensureFriendNames(new Set(["friend-1"]), new Map())

    // Both resolutions share the one cached /friendships fetch.
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("keeps the UI resilient when the friendship request fails", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"))
    const cache = new Map<string, string>()

    await expect(ensureFriendNames(new Set(["friend-1"]), cache)).resolves.toBeUndefined()
    expect(cache.size).toBe(0)
  })
})

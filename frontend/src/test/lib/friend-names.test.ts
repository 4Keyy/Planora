import { afterEach, describe, expect, it, vi } from "vitest"
import { ensureFriendNames } from "@/lib/friend-names"
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

  it("loads friend names and formats full-name and email fallbacks", async () => {
    vi.spyOn(api, "get").mockResolvedValue({
      data: {
        value: page([
          friend({ id: "friend-1", firstName: "Ada", lastName: "Lovelace" }),
          friend({ id: "friend-2", email: "grace@example.com", firstName: "", lastName: "" }),
          friend({ id: "friend-3", email: "", firstName: "", lastName: "" }),
        ]),
      },
    })
    const cache = new Map<string, string>()

    await ensureFriendNames(new Set(["friend-1", "friend-2", "friend-3"]), cache)

    expect(cache.get("friend-1")).toBe("Ada Lovelace")
    expect(cache.get("friend-2")).toBe("grace")
    expect(cache.get("friend-3")).toBe("Friend")
  })

  it("continues across paged friendship results and stops when remaining ids are found", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) =>
      friend({ id: `other-${index}`, firstName: `Other${index}`, lastName: "" }),
    )
    vi.spyOn(api, "get")
      .mockResolvedValueOnce({ data: page(firstPage, true) })
      .mockResolvedValueOnce({
        data: {
          items: [
            friend({ id: "friend-1", firstName: "Ada", lastName: "" }),
            friend({ id: "friend-2", firstName: "", lastName: "", email: "grace@example.com" }),
          ],
          pageNumber: 2,
          pageSize: 200,
          totalCount: 202,
          totalPages: 2,
          hasPreviousPage: true,
          hasNextPage: false,
        },
      })
    const cache = new Map<string, string>()

    await ensureFriendNames(new Set(["friend-1", "friend-2"]), cache)

    expect(cache.get("friend-1")).toBe("Ada")
    expect(cache.get("friend-2")).toBe("grace")
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it("keeps the UI resilient when the friendship request fails", async () => {
    vi.spyOn(api, "get").mockRejectedValue(new Error("offline"))
    const cache = new Map<string, string>()

    await expect(ensureFriendNames(new Set(["friend-1"]), cache)).resolves.toBeUndefined()
    expect(cache.size).toBe(0)
  })
})

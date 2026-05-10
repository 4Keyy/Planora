import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CSRF_HEADER_NAME,
  clearCsrfToken,
  fetchCsrfToken,
  getCsrfToken,
  shouldIncludeCsrfToken,
} from "@/lib/csrf"

const clearCookie = () => {
  document.cookie = "XSRF-TOKEN=; Max-Age=0; path=/"
}

describe("csrf helpers", () => {
  afterEach(() => {
    clearCookie()
    vi.unstubAllGlobals()
  })

  it("uses the expected header name for double-submit CSRF protection", () => {
    expect(CSRF_HEADER_NAME).toBe("X-CSRF-Token")
  })

  it("clears the readable XSRF-TOKEN cookie", () => {
    document.cookie = "XSRF-TOKEN=to-clear; path=/"

    clearCsrfToken()

    expect(document.cookie).not.toContain("XSRF-TOKEN=")
  })

  it.each(["POST", "post", "PUT", "DELETE", "PATCH"])(
    "requires a CSRF token for %s requests",
    (method) => {
      expect(shouldIncludeCsrfToken(method)).toBe(true)
    },
  )

  it.each(["GET", "HEAD", "OPTIONS"])(
    "does not require a CSRF token for %s requests",
    (method) => {
      expect(shouldIncludeCsrfToken(method)).toBe(false)
    },
  )

  it("reads and decodes an existing XSRF-TOKEN cookie", async () => {
    document.cookie = "XSRF-TOKEN=token%20with%20space; path=/"

    await expect(getCsrfToken()).resolves.toBe("token with space")
  })

  it("preserves base64 padding when reading the XSRF-TOKEN cookie", async () => {
    document.cookie = "XSRF-TOKEN=abc123%3D%3D; path=/"

    await expect(getCsrfToken()).resolves.toBe("abc123==")
  })

  it("fetches a CSRF token when the cookie is absent", async () => {
    const fetchMock = vi.fn(async () => {
      document.cookie = "XSRF-TOKEN=fetched-token; path=/"
      return { ok: true, status: 200 } as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchCsrfToken()).resolves.toBe("fetched-token")
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/api/v1/auth/csrf-token"),
      expect.objectContaining({
        method: "GET",
        credentials: "include",
      }),
    )
  })

  it("gets a fresh CSRF token when no cookie exists", async () => {
    const fetchMock = vi.fn(async () => {
      document.cookie = "XSRF-TOKEN=fetched-through-get; path=/"
      return { ok: true, status: 200 } as Response
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(getCsrfToken()).resolves.toBe("fetched-through-get")
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("shares concurrent CSRF endpoint fetches", async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    const fetchMock = vi.fn(
      () => new Promise<Response>((resolve) => {
        resolveFetch = resolve
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const first = fetchCsrfToken()
    const second = fetchCsrfToken()

    expect(fetchMock).toHaveBeenCalledOnce()

    document.cookie = "XSRF-TOKEN=shared-token; path=/"
    resolveFetch?.({ ok: true, status: 200 } as Response)

    await expect(Promise.all([first, second])).resolves.toEqual([
      "shared-token",
      "shared-token",
    ])
  })

  it("fails when the CSRF endpoint rejects the request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503 }) as Response))

    await expect(fetchCsrfToken()).rejects.toThrow("Failed to fetch CSRF token: 503")
  })

  it("fails when the endpoint does not set the XSRF-TOKEN cookie", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 }) as Response))

    await expect(fetchCsrfToken()).rejects.toThrow("XSRF-TOKEN cookie was not set")
  })
})

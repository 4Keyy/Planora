import { render } from "@testing-library/react"
import { createElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ getCsrfToken: vi.fn() }))

vi.mock("@/lib/config", () => ({ getApiBaseUrl: () => "http://localhost:5132" }))
vi.mock("@/lib/csrf", () => ({ CSRF_HEADER_NAME: "X-CSRF-Token", getCsrfToken: mocks.getCsrfToken }))

// The module counts and remembers what it sent per page load, so each test loads it fresh.
const load = async () => {
  vi.resetModules()
  const reporting = await import("@/lib/client-errors")
  const demo = await import("@/lib/demo/flag")
  return { ...reporting, setDemoSession: demo.setDemoSession }
}

const reports = () => vi.mocked(fetch).mock.calls.map(([url, init]) => ({
  url,
  init,
  headers: init?.headers as Record<string, string>,
  body: JSON.parse(String(init?.body)),
}))

const rejection = (reason: unknown) => Object.assign(new Event("unhandledrejection"), { reason })

beforeEach(() => {
  mocks.getCsrfToken.mockResolvedValue("csrf-token")
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })))
  window.history.pushState({}, "", "/dashboard?invite=secret#top")
})

afterEach(() => {
  vi.unstubAllGlobals()
  window.history.pushState({}, "", "/")
})

describe("client error reports", () => {
  it("sends an unhandled rejection to the service logs, anonymously and without the query", async () => {
    const { installClientErrorReporting } = await load()
    const uninstall = installClientErrorReporting()

    window.dispatchEvent(rejection(new TypeError("Cannot read properties of undefined")))

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const [report] = reports()
    expect(report.url).toBe("http://localhost:5132/auth/api/v1/client-errors")
    expect(report.init).toMatchObject({ method: "POST", credentials: "include", keepalive: true })
    expect(report.headers["X-CSRF-Token"]).toBe("csrf-token")
    expect(report.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
    expect(report.headers.Authorization).toBeUndefined()
    expect(report.body).toMatchObject({
      kind: "unhandledrejection",
      name: "TypeError",
      message: "Cannot read properties of undefined",
      route: "/dashboard",
    })
    expect(report.body.stack).toContain("TypeError")
    uninstall()
  })

  it("reports an uncaught error, and nothing once uninstalled", async () => {
    const { installClientErrorReporting } = await load()
    const uninstall = installClientErrorReporting()
    // These errors are the test's own: handled, so the runner does not count them as uncaught.
    const handled = (event: ErrorEvent) => event.preventDefault()
    window.addEventListener("error", handled)
    const uncaught = (message: string) =>
      new ErrorEvent("error", { error: new Error(message), message, cancelable: true })

    window.dispatchEvent(uncaught("render blew up"))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    expect(reports()[0].body).toMatchObject({ kind: "error", message: "render blew up" })

    uninstall()
    window.dispatchEvent(uncaught("after"))
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledOnce()
    window.removeEventListener("error", handled)
  })

  it("never sends a token, and says where a failed request went without its query", async () => {
    const { reportClientError } = await load()

    reportClientError(Object.assign(new Error("Request failed with status code 500 Bearer abc.def.ghi"), {
      isAxiosError: true,
      response: { status: 500 },
      config: { method: "put", url: "/todos/api/v1/todos/1?access_token=abc", headers: { Authorization: "Bearer abc" } },
    }), "unhandledrejection")

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    const sent = String(vi.mocked(fetch).mock.calls[0][1]?.body)
    expect(sent).not.toContain("abc")
    expect(reports()[0].body.message).toBe("Request failed with status code 500 Bearer [redacted] [PUT /todos/api/v1/todos/1 500]")
  })

  it("sends the same failure once and at most ten reports a page load", async () => {
    const { reportClientError } = await load()

    reportClientError(new Error("same"), "error")
    reportClientError(new Error("same"), "error")
    for (let i = 0; i < 15; i++) reportClientError(new Error(`distinct ${i}`), "error")

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(10))
    expect(reports().map((report) => report.body.message)).toEqual(["same", ...Array.from({ length: 9 }, (_, i) => `distinct ${i}`)])
  })

  it("keeps a valid digest and drops anything else in its place", async () => {
    const { reportClientError } = await load()

    reportClientError(new Error("one"), "boundary", "1742815393")
    reportClientError(new Error("two"), "segment", "not a digest!")

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    expect(reports().map((report) => report.body.digest)).toEqual(["1742815393", undefined])
  })

  it("ignores noise there is nothing to act on", async () => {
    const { reportClientError } = await load()

    reportClientError("Script error.", "error")
    reportClientError(new Error("ResizeObserver loop completed with undelivered notifications."), "error")

    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("stays off the network in the demo sandbox", async () => {
    const { reportClientError, setDemoSession } = await load()
    setDemoSession(true)

    reportClientError(new Error("in the sandbox"), "error")

    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    setDemoSession(false)
  })

  it("never fails itself when the report cannot be sent", async () => {
    const { reportClientError } = await load()
    mocks.getCsrfToken.mockRejectedValue(new Error("offline"))

    expect(() => reportClientError(new Error("while offline"), "error")).not.toThrow()
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("is installed by the root reporter component while it is mounted", async () => {
    vi.resetModules()
    const { ClientErrorReporter } = await import("@/components/client-error-reporter")
    const { unmount } = render(createElement(ClientErrorReporter))

    window.dispatchEvent(rejection(new Error("from anywhere")))
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())

    unmount()
    window.dispatchEvent(rejection(new Error("after unmount")))
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledOnce()
  })
})

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { disableDemo, enableDemo, isDemoInstalled } from "@/lib/demo/enable"
import { demo, DEMO_USER } from "@/lib/demo/state"

/**
 * The sandbox switch.
 *
 * The failure mode worth guarding against is not "the demo does not work" — that is
 * visible immediately. It is the demo **leaking**: `api` is a module singleton shared
 * with every authenticated route, so an adapter left installed would mean a real session
 * talking to a fake server, and a seeded session left behind would mean a signed-out
 * visitor appearing signed in. Both are silent.
 */

beforeEach(() => {
  disableDemo()
  useAuthStore.setState({ isAuthenticated: false, accessToken: undefined, user: undefined })
})

afterEach(() => disableDemo())

describe("scope", () => {
  it("installs on the landing route", () => {
    enableDemo("/")
    expect(isDemoInstalled()).toBe(true)
  })

  it("refuses every other route", () => {
    for (const path of ["/tasks", "/dashboard", "/auth/login", "/profile", "/branch/dt-1", ""]) {
      disableDemo()
      enableDemo(path)
      expect(isDemoInstalled(), `installed on ${JSON.stringify(path)}`).toBe(false)
    }
  })

  it("is idempotent, so a re-render cannot stack adapters", () => {
    enableDemo("/")
    const first = api.defaults.adapter
    enableDemo("/")
    expect(api.defaults.adapter).toBe(first)
  })
})

describe("the transport swap is reversible", () => {
  it("restores the previous adapter on teardown", () => {
    const original = api.defaults.adapter
    enableDemo("/")
    expect(api.defaults.adapter).not.toBe(original)
    disableDemo()
    // If this ever regresses, an authenticated route starts answering from memory.
    expect(api.defaults.adapter).toBe(original)
  })

  it("leaves the adapter alone when it never installed", () => {
    const original = api.defaults.adapter
    enableDemo("/tasks")
    expect(api.defaults.adapter).toBe(original)
    disableDemo()
    expect(api.defaults.adapter).toBe(original)
  })
})

describe("the seeded session", () => {
  it("authenticates, so the palette and the list are not dead on arrival", () => {
    enableDemo("/")
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(true)
    expect(s.user?.userId).toBe(DEMO_USER.userId)
    // The product's own guard. A token-less seed passes `isAuthenticated` and still
    // fails here, which would leave the console loading forever.
    expect(s.isTokenValid()).toBe(true)
  })

  it("mints a decodable token, because the client only ever decodes", () => {
    enableDemo("/")
    const token = useAuthStore.getState().accessToken
    expect(token).toBeTruthy()
    const [, payload] = (token as string).split(".")
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub: string
      exp: number
    }
    expect(claims.sub).toBe(DEMO_USER.userId)
    expect(claims.exp * 1000).toBeGreaterThan(Date.now())
  })

  it("clears the session on teardown", () => {
    enableDemo("/")
    disableDemo()
    const s = useAuthStore.getState()
    expect(s.isAuthenticated).toBe(false)
    expect(s.accessToken).toBeFalsy()
  })
})

describe("state lifecycle", () => {
  it("reseeds on install, so a second visit starts clean", () => {
    enableDemo("/")
    demo.deleteTodo("dt-1")
    expect(demo.todos().some((t) => t.id === "dt-1")).toBe(false)

    disableDemo()
    enableDemo("/")
    expect(demo.todos().some((t) => t.id === "dt-1")).toBe(true)
  })
})

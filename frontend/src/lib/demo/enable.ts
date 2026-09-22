import { api } from "@/lib/api"
import { useAuthStore } from "@/store/auth"
import { demoAdapter } from "./adapter"
import { demo, DEMO_USER } from "./state"
import { setDemoSession } from "./flag"

/**
 * Turns the landing page into a working sandbox, and turns it off again on the way out.
 *
 * Two things happen, and both are reversible.
 *
 * **The transport is swapped.** `api.defaults.adapter` points at `demoAdapter`, so every
 * call the product makes is answered from memory — through the real interceptors. The
 * previous adapter is captured and restored on teardown, because `api` is a module
 * singleton shared with every other route: leaving this installed would mean a real
 * session talking to a fake server.
 *
 * **A session is seeded.** The components guard on `isAuthenticated`, and the command
 * palette returns `null` without it. The token is an `alg: none` JWT, which is enough
 * because the client only ever *decodes* it — `lib/jwt.ts` splits on `.`, base64-decodes
 * the payload and parses it, with no signature check anywhere. That is a deliberate
 * property of the design (the server verifies; the client only needs the claims), and it
 * is what the audit harness already relies on.
 *
 * **This is not a deception.** The page says on screen that it is a sandbox with invented
 * people, nothing leaves the browser, and no account exists. What would be a deception is
 * the opposite: a landing page claiming keys work when they do not, which is what this
 * replaces.
 *
 * Scope is enforced by the caller — `DemoSandbox` mounts only on `/` and tears down on
 * unmount. The guard is repeated here because a demo session leaking into a real route is
 * the one failure mode of this approach that would matter.
 */

const DEMO_ROUTE = "/"

/** An `alg: none` JWT. Base64url, no padding — the client's decoder is strict about that. */
function mintToken(): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  const header = { alg: "none", typ: "JWT" }
  // `exp` is derived from the real clock on purpose: this one is never rendered, and an
  // expiry in the past would make `isTokenValid()` false and gate the whole sandbox.
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: DEMO_USER.userId,
    email: DEMO_USER.email,
    firstName: DEMO_USER.firstName,
    lastName: DEMO_USER.lastName,
    email_verified: "true",
    role: "User",
    iat: now,
    exp: now + 3600,
  }
  return `${b64(header)}.${b64(payload)}.demo-not-verified-client-side`
}

let previousAdapter: typeof api.defaults.adapter
let installed = false

export function enableDemo(pathname: string): void {
  if (installed || pathname !== DEMO_ROUTE) return
  installed = true

  // Before the session is seeded, not after: RealtimeManager reads this on the render
  // that seeding triggers, and a socket opened in that gap retries forever.
  setDemoSession(true)
  demo.reset()

  previousAdapter = api.defaults.adapter
  api.defaults.adapter = demoAdapter

  // The request interceptor echoes this cookie into `X-CSRF-Token` for every mutation,
  // and fetches one over the network if it is missing. Seeding it keeps the sandbox off
  // the network entirely — `csrf.ts` reads the cookie directly and never calls out.
  if (typeof document !== "undefined") {
    document.cookie = "XSRF-TOKEN=demo-csrf; Path=/; SameSite=Strict"
  }

  useAuthStore.getState().setAuth({
    userId: DEMO_USER.userId,
    email: DEMO_USER.email,
    firstName: DEMO_USER.firstName,
    lastName: DEMO_USER.lastName,
    accessToken: mintToken(),
  })
}

export function disableDemo(): void {
  if (!installed) return
  installed = false

  setDemoSession(false)
  api.defaults.adapter = previousAdapter
  // silent: this is not a logout. clearAuth broadcasts to other tabs by default, and a
  // visitor leaving a sandbox must not sign out the session they have open elsewhere.
  useAuthStore.getState().clearAuth(true)
  demo.reset()
}

/** For tests: whether the sandbox currently owns the transport. */
export function isDemoInstalled(): boolean {
  return installed
}

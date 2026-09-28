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
 *
 * ## Ordering: the sandbox installs only after the real session restore has finished
 *
 * `SecurityInitializer` runs `restoreSession()` once per page load, and this used to race
 * it. An anonymous visitor's silent refresh failed a moment after the seed and called
 * `clearAuth()`, wiping the demo session (the landing keys went dead) and broadcasting a
 * logout to every other tab. When the seed won instead, restore POSTed this unsigned token
 * to the real server's `validate-token` — through `lib/auth-public.ts`, which the adapter
 * swap does not cover — so the sandbox's "nothing leaves this tab" was false. And for a
 * visitor who really was signed in, restore overwrote the demo token with the real one and
 * `disableDemo()` later erased that real session on the way out of `/`.
 *
 * `DemoSandbox` therefore waits for `hasRestoredSession`, installs this only for a visitor
 * with no real session, and leaves a signed-in visitor's session entirely alone. Once
 * restore is over nothing in the page re-validates a token, so the seeded one never reaches
 * the network.
 *
 * Two more things keep the seed contained while it is installed. The store persists the
 * user's identity to sessionStorage, so on `pagehide` the persisted entry is removed — a
 * reload must never start from a made-up identity. And if the session is cleared from
 * outside (a logout broadcast from another tab), the demo re-seeds itself silently rather
 * than going dead.
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
let unsubscribe: (() => void) | null = null
/** The page's real XSRF-TOKEN, if it had one, put back on teardown. */
let previousCsrf: string | null = null

const CSRF_COOKIE = "XSRF-TOKEN"

function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null
  const row = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`))
  return row ? row.slice(CSRF_COOKIE.length + 1) : null
}

function seed(): void {
  useAuthStore.getState().setAuth({
    userId: DEMO_USER.userId,
    email: DEMO_USER.email,
    firstName: DEMO_USER.firstName,
    lastName: DEMO_USER.lastName,
    accessToken: mintToken(),
  })
}

/** The demo identity must not outlive the page in sessionStorage. */
function forgetPersistedIdentity(): void {
  try {
    useAuthStore.persist.clearStorage()
  } catch {
    // Storage can be unavailable (private mode quotas, a sandboxed frame). Nothing to clear.
  }
}

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
  //
  // The real cookie is remembered and restored on teardown. Overwriting it for good meant
  // the visitor's first write after leaving `/` — signing in, usually — carried a token the
  // server had never issued, and only the interceptor's 403 retry rescued it.
  if (typeof document !== "undefined") {
    previousCsrf = readCsrfCookie()
    document.cookie = `${CSRF_COOKIE}=demo-csrf; Path=/; SameSite=Strict`
  }

  seed()

  // Cleared from outside while installed — a logout broadcast from another tab calls
  // clearAuth(true) here too. Re-seed rather than leave every key on the page dead.
  // setAuth never broadcasts, so this cannot start a loop between tabs.
  unsubscribe = useAuthStore.subscribe((state, prev) => {
    if (installed && prev.isAuthenticated && !state.isAuthenticated) seed()
  })

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", forgetPersistedIdentity)
  }
}

export function disableDemo(): void {
  if (!installed) return
  installed = false

  unsubscribe?.()
  unsubscribe = null
  if (typeof window !== "undefined") {
    window.removeEventListener("pagehide", forgetPersistedIdentity)
  }

  setDemoSession(false)
  api.defaults.adapter = previousAdapter
  if (typeof document !== "undefined") {
    document.cookie =
      previousCsrf !== null
        ? `${CSRF_COOKIE}=${previousCsrf}; Path=/; SameSite=Strict`
        : `${CSRF_COOKIE}=; Path=/; SameSite=Strict; Max-Age=0`
    previousCsrf = null
  }
  // silent: this is not a logout. clearAuth broadcasts to other tabs by default, and a
  // visitor leaving a sandbox must not sign out the session they have open elsewhere.
  useAuthStore.getState().clearAuth(true)
  forgetPersistedIdentity()
  demo.reset()
}

/** For tests: whether the sandbox currently owns the transport. */
export function isDemoInstalled(): boolean {
  return installed
}

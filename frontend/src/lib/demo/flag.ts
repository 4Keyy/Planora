/**
 * Whether the current session is the landing page's sandbox rather than a real one.
 *
 * This exists because seeding a session is not free: the moment `isAuthenticated` turns
 * true, every subsystem that waits for a signed-in user wakes up — including the ones
 * that genuinely need a server. `RealtimeManager` is the sharp one. It is mounted in the
 * root layout and was inert on the landing page only because nobody was ever
 * authenticated there; with a seeded session it opens a SignalR socket, fails the
 * handshake against a gateway the sandbox does not have, and retries on its own backoff
 * indefinitely. Measured while building this: 486 console errors on one page.
 *
 * So the sandbox declares itself, and the one subsystem that cannot be faked opts out.
 * That is also the honest behaviour: with no socket the product falls back to its
 * documented 9-second poll backstop, which the sandbox answers from memory — exactly how
 * the real product behaves when realtime is down.
 *
 * It lives in its own module so the dependency runs one way. `lib/realtime` must not
 * import `lib/demo/enable`, which imports `lib/api`, which the realtime client is
 * adjacent to; a flag with no imports of its own breaks that cycle before it forms.
 */

let demoSession = false

export function setDemoSession(active: boolean): void {
  demoSession = active
}

export function isDemoSession(): boolean {
  return demoSession
}

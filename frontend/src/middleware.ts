import { type NextRequest, NextResponse } from 'next/server'

// Generates a per-request CSP nonce, replacing the static CSP in next.config.js.
// The nonce is forwarded as x-nonce so Server Components can attach it to
// <Script> and inline <style> elements that legitimately need to run inline.
// style-src still requires 'unsafe-inline' because Tailwind CSS and
// Next.js inject critical CSS as inline <style> tags during SSR.
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isDev = process.env.NODE_ENV === 'development'

  const apiOrigin = sanitizeOrigin(
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.NEXT_PUBLIC_API_GATEWAY_URL ||
    'http://localhost:5132'
  )

  const scriptSrc = isDev
    ? `'self' 'nonce-${nonce}' 'unsafe-eval'`
    : `'self' 'nonce-${nonce}'`

  // The client (config.ts getApiBaseUrl) targets the gateway on the SAME host the page was opened
  // from (http://<host>:5132). For a local/LAN viewer that differs from the apiOrigin baked at build
  // — e.g. the page is opened on localhost while NEXT_PUBLIC_API_URL is the LAN IP — so a CSP locked
  // to apiOrigin alone blocks the real fetch ("connect-src ... violates" / "Failed to fetch"). In dev
  // the permissive http/https/ws covers it; in production keep it explicit but ADD the same-host
  // gateway for a local/LAN viewer, each with its ws/wss form for the SignalR realtime channel.
  // The Host header is what the BROWSER actually used (e.g. "localhost:3000"), which is what
  // config.ts getApiBaseUrl keys off (window.location.hostname). request.nextUrl.hostname reflects
  // the SERVER's view under `next start -H 0.0.0.0` (the bind/LAN address), so it must only be a
  // fallback for synthetic requests with no Host header (tests).
  const requestHost = (request.headers.get('host') ?? '').split(':')[0] || request.nextUrl.hostname
  const prodConnectOrigins = new Set<string>([apiOrigin])
  if (isLocalNetworkHost(requestHost)) prodConnectOrigins.add(`http://${requestHost}:5132`)

  const connectSrc = isDev
    ? `'self' ${apiOrigin} http: https: ws: wss:`
    : `'self' ${[...prodConnectOrigins].flatMap(withRealtime).join(' ')}`

  // In dev the avatar server may be on any HTTP origin (localhost, LAN IP, etc.) so `http:` is open.
  // Avatars are served by the gateway. With the local image optimizer bypassed (next.config:
  // imagesUnoptimized), the browser loads them straight from the gateway, so img-src needs the same
  // gateway origins connect-src got (apiOrigin + the same-host gateway for a local/LAN viewer).
  const imgSrc = isDev
    ? `'self' data: https: http:`
    : `'self' data: https: ${[...prodConnectOrigins].join(' ')}`

  const cspParts = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Defence-in-depth: deny plugin objects, embedded browsing contexts, and
    // dedicated workers spawned from foreign origins. None of these are used by
    // the app today; locking them down narrows the reflected-XSS payload surface.
    "object-src 'none'",
    "child-src 'none'",
    "worker-src 'self'",
  ]

  if (!isDev && apiOrigin.startsWith('https://')) {
    cspParts.push('upgrade-insecure-requests')
  }

  const csp = cspParts.join('; ')

  // Forward nonce to Server Components via a request header they can read.
  // The CSP is also set on the *request* headers: Next.js reads the nonce from
  // the request CSP header to stamp it onto its own inline framework scripts
  // (and to opt the route into dynamic rendering). Without it, the strict
  // script-src blocks Next.js's un-nonced inline bootstrap scripts.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)

  return response
}

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

function sanitizeOrigin(raw: string): string {
  try {
    const url = new URL(raw)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.origin
    }
  } catch {
    // fall through
  }
  return 'http://localhost:5132'
}

// Mirrors config.ts: loopback + RFC1918 private-LAN hosts are the ones for which the client rewrites
// the gateway to the same host it was opened from. Kept local so middleware stays Edge-self-contained.
function isLocalNetworkHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
  const parts = hostname.split('.').map((p) => Number(p))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false
  const [a, b] = parts
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

// Expands a gateway origin into its http(s) origin plus the matching WebSocket scheme (ws/wss) — the
// SignalR realtime channel needs the ws form in connect-src alongside the plain fetch origin.
function withRealtime(origin: string): string[] {
  try {
    const u = new URL(origin)
    const ws = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return [u.origin, `${ws}//${u.host}`]
  } catch {
    return [origin]
  }
}

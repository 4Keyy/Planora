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

  // In dev the page can be opened from a LAN IP (a peer on the same Wi-Fi), and the
  // client derives the API gateway as `http://<sameHost>:5132` at runtime — which varies
  // by viewer. Allowing http/https/ws in dev lets any same-LAN host reach the gateway,
  // mirroring the equally-permissive dev `img-src` below. Production stays locked to the
  // single explicit API origin.
  const connectSrc = isDev
    ? `'self' ${apiOrigin} http: https: ws: wss:`
    : `'self' ${apiOrigin}`

  // In dev the avatar server may be on any HTTP origin (localhost, LAN IP, etc.),
  // and SSR vs client can resolve to different hosts. Allowing all `http:` in dev
  // is intentional — production locks it to the specific API origin only.
  const imgSrc = isDev
    ? `'self' data: https: http:`
    : `'self' data: https: ${apiOrigin}`

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

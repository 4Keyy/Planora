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

  const connectSrc = isDev
    ? `'self' ${apiOrigin} http://localhost:5132 http://127.0.0.1:5132`
    : `'self' ${apiOrigin}`

  const cspParts = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]

  if (!isDev && apiOrigin.startsWith('https://')) {
    cspParts.push('upgrade-insecure-requests')
  }

  const csp = cspParts.join('; ')

  // Forward nonce to Server Components via a request header they can read
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-nonce', nonce)

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

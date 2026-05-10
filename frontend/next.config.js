/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development'

const defaultApiUrl = 'http://localhost:5132'
const apiUrl = process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_GATEWAY_URL || defaultApiUrl
const safeApiUrl = (() => {
  try {
    const url = new URL(apiUrl)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/' && !url.search && !url.hash) {
      return url.origin
    }
  } catch {
    // Fall back to the local gateway below.
  }
  return defaultApiUrl
})()
const shouldUpgradeInsecureRequests = !isDev && safeApiUrl.startsWith('https://')
const frontendBaseApiUrl = (() => {
  try {
    const frontendBaseUrl = process.env.Frontend__BaseUrl
    if (!frontendBaseUrl) return undefined

    const url = new URL(frontendBaseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return `${url.protocol}//${url.hostname}:5132`
  } catch {
    return undefined
  }
})()
const connectSources = [
  "'self'",
  safeApiUrl,
  ...(isDev ? [defaultApiUrl, 'http://127.0.0.1:5132', frontendBaseApiUrl] : []),
].filter(Boolean)
const uniqueConnectSources = [...new Set(connectSources)]

// SECURITY: Content-Security-Policy
// In production, tighten this further by removing 'unsafe-inline' from style-src
// and using nonce-based or hash-based CSP for any inline styles.
const cspDirectives = [
  "default-src 'self'",
  // Dev: Next.js HMR/Fast Refresh requires unsafe-eval and unsafe-inline
  isDev ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",          // Next.js requires unsafe-inline for CSS-in-JS
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src " + uniqueConnectSources.join(' '), // API calls
  "frame-ancestors 'none'",                    // Clickjacking protection
  "base-uri 'self'",
  "form-action 'self'",
]

if (shouldUpgradeInsecureRequests) {
  cspDirectives.push("upgrade-insecure-requests")
}

const cspHeader = cspDirectives.join('; ')

const securityHeaders = [
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Content-Security-Policy',   value: cspHeader },
  // SECURITY: HSTS — tells browsers to only connect via HTTPS for the next year.
  // Only enable in production; development uses HTTP.
  ...(isDev ? [] : [{
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  }]),
]

const nextConfig = {
  reactStrictMode: true,
  compress: true,
  eslint: {
    // Lint is an explicit CI gate (`npm run lint`). Next's build-time lint hook
    // still passes deprecated ESLint options in this toolchain and emits noise.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      // SECURITY: wildcard limited to dev; add specific production hostnames here as needed.
      ...(isDev ? [{ protocol: 'https', hostname: '**' }, { protocol: 'http', hostname: 'localhost' }] : []),
    ],
  },
  experimental: {
    optimizeCss: true,
    optimizePackageImports: [
      'framer-motion',
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-select',
      '@radix-ui/react-popover',
      '@radix-ui/react-toast',
      '@radix-ui/react-avatar',
      '@radix-ui/react-tabs',
      '@radix-ui/react-switch',
    ],
    serverActions: {
      allowedOrigins: [
        'localhost:3000',
        ...(isDev ? ['fkeyylaptop:3000', '192.169.3.4:3000'] : []),
      ],
    },
  },
  env: {
    NEXT_PUBLIC_API_URL: safeApiUrl,
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: '/favicon.ico',
        destination: '/favicon.svg',
      },
    ]
  },
}

module.exports = nextConfig

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
// CSP is set per-request with a unique nonce by src/middleware.ts.
// Only static security headers that don't need per-request variability remain here.
const securityHeaders = [
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=()' },
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
      // localhost:3000 is restricted to development only; add the production
      // FQDN here (e.g. 'app.planora.com') when deploying.
      allowedOrigins: [
        ...(isDev ? ['localhost:3000'] : []),
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

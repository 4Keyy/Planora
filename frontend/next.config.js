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
  // SECURITY: strict-origin sends ONLY the origin (no path, no query) on
  // cross-origin navigations and full URL only on same-origin. Previous
  // strict-origin-when-cross-origin leaked the full pathname + query (e.g.
  // a todo description with a URL token) to external sites the user clicked
  // through to. Same-origin links still get the full URL so internal
  // analytics keep working.
  { key: 'Referrer-Policy',           value: 'strict-origin' },
  // SECURITY: deny every sensitive browser API. None of these are used by
  // Planora today; the explicit deny narrows the attack surface for a
  // compromised third-party script or a future XSS escape.
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=()',
      'browsing-topics=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'hid=()',
      'idle-detection=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'picture-in-picture=()',
      'publickey-credentials-get=()',
      'screen-wake-lock=()',
      'serial=()',
      'usb=()',
      'web-share=()',
      'xr-spatial-tracking=()',
    ].join(', '),
  },
  // Cross-Origin-Opener-Policy isolates this top-level window from any
  // unrelated cross-origin window, blocking Spectre-class cross-origin
  // leaks and improving the security of postMessage flows.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Cross-Origin-Resource-Policy declares that this resource is only
  // intended to be loaded from same-origin documents. Defence-in-depth
  // against the same Spectre family.
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
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
    remotePatterns: (() => {
      // In dev: allow any HTTPS host + any HTTP host (API may be on a LAN IP, not localhost).
      // In production: restrict to the explicit API hostname only.
      if (isDev) {
        return [
          { protocol: 'https', hostname: '**' },
          { protocol: 'http', hostname: '**' },
        ]
      }
      try {
        const u = new URL(apiUrl)
        return [{ protocol: /** @type {'http'|'https'} */ (u.protocol.replace(':', '')), hostname: u.hostname }]
      } catch {
        return []
      }
    })(),
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

/** @type {import('next').NextConfig} */

const os = require('os')

const isDev = process.env.NODE_ENV === 'development'

// When the dev server is shared on the LAN (`next dev -H 0.0.0.0`), a teammate opens it via the
// host's LAN IP (e.g. http://192.168.x.y:3000). Next 16 treats that as a cross-origin dev request
// and blocks the internal `/_next/*` resources — including the HMR websocket — unless the origin is
// allow-listed. Collect this machine's own non-internal IPv4 addresses so those LAN origins are
// trusted in dev (no-op in production, where `allowedDevOrigins` is ignored). An explicit
// comma-separated NEXT_DEV_ALLOWED_ORIGINS env var can add more.
const devAllowedOrigins = (() => {
  if (!isDev) return []
  const fromEnv = (process.env.NEXT_DEV_ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  const lanIps = []
  for (const ifaces of Object.values(os.networkInterfaces() || {})) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) lanIps.push(iface.address)
    }
  }
  return [...new Set([...lanIps, ...fromEnv])]
})()

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
  // Cross-Origin-Opener-Policy / Cross-Origin-Resource-Policy isolate this top-level window and
  // resource from unrelated cross-origin contexts (Spectre-class defence-in-depth). The browser
  // only honours these on a *secure* context (HTTPS or localhost) and ignores them — with a console
  // warning — when the page is served over plain HTTP, e.g. a teammate opening the LAN dev URL
  // http://192.168.x.y:3000. So apply them in production only; in dev they add noise without effect.
  ...(isDev ? [] : [
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    // SECURITY: HSTS — tells browsers to only connect via HTTPS for the next year. Production only.
    {
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains; preload',
    },
  ]),
]

const nextConfig = {
  reactStrictMode: true,
  compress: true,
  // Trust the host's own LAN IPs in dev so a teammate opening the shared `next dev -H 0.0.0.0`
  // URL gets the internal `/_next/*` resources (incl. the HMR websocket) instead of cross-origin
  // blocks. Empty (and ignored) in production.
  allowedDevOrigins: devAllowedOrigins,
  images: {
    // Next.js 16 hardened the image optimizer against SSRF: it refuses to fetch an
    // upstream image whose host resolves to a private / loopback IP (127.0.0.1, ::1) and
    // returns `400 "...resolved to private ip"`. In local dev the avatars are served by
    // the API gateway on localhost (→ 127.0.0.1), so the optimizer blocked every avatar.
    // Image optimization is a production concern (avatars are already small pre-rendered
    // webp), so bypass the optimizer in dev and let the browser load the avatar straight
    // from the gateway — the dev CSP `img-src` already allows `http:`. Production keeps
    // optimization on; the gateway there is a public host, not a private IP.
    unoptimized: isDev,
    remotePatterns: (() => {
      // In dev: allow any HTTPS host + any HTTP host (API may be on a LAN IP, not localhost).
      // In production: restrict to the explicit API host (and its port, if non-default).
      if (isDev) {
        return [
          { protocol: 'https', hostname: '**' },
          { protocol: 'http', hostname: '**' },
        ]
      }
      try {
        const u = new URL(apiUrl)
        /** @type {{protocol:'http'|'https',hostname:string,port?:string}} */
        const pattern = {
          protocol: /** @type {'http'|'https'} */ (u.protocol.replace(':', '')),
          hostname: u.hostname,
        }
        // Include the port only when the URL specifies a non-default one, so the
        // production pattern matches the gateway whether it runs on 443 or an explicit port.
        if (u.port) pattern.port = u.port
        return [pattern]
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
    // Same-origin API proxy. When the dev server is reached through a tunnel /
    // single-forwarded-port (e.g. a phone that can hit :3000 but not the gateway's
    // :5132), getApiBaseUrl() (src/lib/config.ts) routes API calls at the frontend's
    // own origin; these rewrites forward those paths to the API gateway so one port
    // is enough. They are scoped to the gateway's `/api` (and /realtime, /avatars)
    // sub-paths so they never shadow the frontend's own /auth/* or /categories pages,
    // and they are inert for localhost / LAN-IP access (which call the gateway
    // directly with an absolute URL and never hit these frontend paths).
    const gatewayProxies = [
      '/auth/api/:path*',
      '/todos/api/:path*',
      '/categories/api/:path*',
      '/collaboration/api/:path*',
      '/messaging/api/:path*',
      '/realtime/:path*',
      '/avatars/:path*',
    ].map((source) => ({ source, destination: `${safeApiUrl}${source}` }))

    return [
      {
        source: '/favicon.ico',
        destination: '/favicon.svg',
      },
      ...gatewayProxies,
    ]
  },
}

module.exports = nextConfig

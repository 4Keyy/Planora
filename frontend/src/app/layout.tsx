import "./globals.css"
import "@fontsource/plus-jakarta-sans/300.css"
import "@fontsource/plus-jakarta-sans/400.css"
import "@fontsource/plus-jakarta-sans/500.css"
import "@fontsource/plus-jakarta-sans/600.css"
import "@fontsource/plus-jakarta-sans/700.css"
import "@fontsource/plus-jakarta-sans/800.css"
import { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Toaster } from "@/components/ui/toast"
import { SecurityInitializer } from "@/components/security-initializer"
import { RealtimeManager } from "@/components/realtime-manager"
import { ErrorBoundary } from "@/components/error-boundary"
import { ColorBendsLayer } from "@/components/backgrounds/color-bends-layer"
import { MotionPreferencesProvider } from "@/components/motion-preferences-provider"

export const metadata = {
  title: "Planora | Private Shared Tasks",
  description: "Private shared tasks for friends and family with secure sessions, messaging, and accountability.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
}

// Render every route per-request so the CSP middleware's per-request nonce
// (src/middleware.ts) is applied to Next.js inline scripts. A statically
// prerendered page cannot carry a per-request nonce, which would leave the
// strict script-src blocking the framework's own bootstrap scripts.
//
// The full trade-off (TTFB cost vs nonce-only script-src) is documented in
// ADR-0006 (`docs/DECISIONS/0006-force-dynamic-and-csp-nonce.md`). Removing
// this line requires landing hash-based CSP first — see the sunset
// conditions in that ADR.
export const dynamic = "force-dynamic"

// Resolve the API origin at module evaluation time so the resource hints below
// receive a real URL rather than a literal placeholder. NEXT_PUBLIC_API_URL is
// inlined at build time by Next.js, so this runs once per build and stays
// constant per deploy. Bad input (missing, malformed, non-http) falls back to
// the local gateway so the layout never emits a broken `<link>` tag.
function resolveApiOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_API_URL
    || process.env.NEXT_PUBLIC_API_GATEWAY_URL
    || "http://localhost:5132"
  try {
    const url = new URL(raw)
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.origin
    }
  } catch {
    /* fall through */
  }
  return null
}

const apiOrigin = resolveApiOrigin()

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={cn("font-sans")}>
      <head>
        <meta name="google" content="notranslate" />
        {/* Resource hints — open the connection to the API gateway in parallel
            with the page render. `preconnect` reserves the DNS + TCP + TLS
            handshake (~100-300 ms savings on first auth/csrf-token fetch);
            `dns-prefetch` is the no-CORS fallback for browsers that ignore
            the preconnect (Safari ≤ 14, older mobile). Emitted only when the
            API origin is well-formed so we never ship a broken `<link>` tag. */}
        {apiOrigin ? (
          <>
            <link rel="preconnect" href={apiOrigin} crossOrigin="" />
            <link rel="dns-prefetch" href={apiOrigin} />
          </>
        ) : null}
      </head>
      <body className={cn("text-gray-900 antialiased min-h-screen bg-transparent")}>
        <ColorBendsLayer />
        <SecurityInitializer />
        <RealtimeManager />
        {/* T4.10 — global MotionConfig with reducedMotion="user" makes every
            framer-motion component in the tree automatically honour the OS
            prefers-reduced-motion setting (transforms collapse, opacity stays).
            Individual components can still override via useReducedMotion().
            Toaster lives inside the provider too — its slide/fade animations
            otherwise bypass the preference. ColorBendsLayer stays outside
            because it does its own `prefers-reduced-motion: reduce` check
            via `window.matchMedia` against the WebGL render loop. */}
        <MotionPreferencesProvider>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
          <Toaster />
        </MotionPreferencesProvider>
      </body>
    </html>
  )
}

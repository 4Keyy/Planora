import "./globals.css"
/**
 * Four weights, two subsets — and nothing else.
 *
 * The bare `<weight>.css` entry points each declare FOUR @font-face rules (latin,
 * latin-ext, vietnamese, cyrillic-ext), so six of them shipped 24 font files to
 * build an English-language product. Weights 300 and 800 were not in the type
 * scale at all, and `font-weight: 900` appeared once in the colour picker — a
 * weight no file provides, which the browser answers by synthetically emboldening
 * the 800 face. The type scale defines exactly four weights (400/500/600/700) and
 * those are the four loaded here.
 *
 * latin-ext stays: names, categories and comments are user text and routinely
 * carry accented Latin characters. vietnamese and cyrillic-ext do not — the UI is
 * English and any stray glyph falls back to the system stack, which is the correct
 * outcome rather than a reason to ship two more subsets.
 */
import "@fontsource/plus-jakarta-sans/latin-400.css"
import "@fontsource/plus-jakarta-sans/latin-500.css"
import "@fontsource/plus-jakarta-sans/latin-600.css"
import "@fontsource/plus-jakarta-sans/latin-700.css"
import "@fontsource/plus-jakarta-sans/latin-ext-400.css"
import "@fontsource/plus-jakarta-sans/latin-ext-500.css"
import "@fontsource/plus-jakarta-sans/latin-ext-600.css"
import "@fontsource/plus-jakarta-sans/latin-ext-700.css"
import { ReactNode } from "react"
import type { Viewport } from "next"
import { cn } from "@/lib/utils"
import { Toaster } from "@/components/ui/toast"
import { SecurityInitializer } from "@/components/security-initializer"
import { RealtimeManager } from "@/components/realtime-manager"
import { ErrorBoundary } from "@/components/error-boundary"
import { ColorBendsLayer } from "@/components/backgrounds/color-bends-layer"
import { MotionPreferencesProvider } from "@/components/motion-preferences-provider"
import { CommandPalette } from "@/components/command-palette"
import { ShortcutsHelp } from "@/components/ui/shortcuts-overlay"

export const metadata = {
  // Every route sets its own title through this template, so tabs, history and
  // the screen-reader announcement name the screen rather than the product.
  title: {
    default: "Planora | Private Shared Tasks",
    template: "%s · Planora",
  },
  description: "Private shared tasks for friends and family with secure sessions, messaging, and accountability.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
}

// viewport-fit=cover exposes the iPhone safe-area insets (notch / Dynamic
// Island / home indicator) to env(safe-area-inset-*), which the navbar and
// globals.css consume. themeColor tints the mobile browser chrome to match the
// light UI. maximumScale/userScalable are intentionally left at their defaults
// so pinch-zoom stays available — disabling it is a WCAG 1.4.4 violation.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "var(--pl-paper)",
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
      <body className={cn("text-ink antialiased min-h-screen bg-transparent")}>
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
          {/* Mounted at the root so Cmd/Ctrl+K reaches it from any screen, and so
              it survives a route change without remounting mid-keystroke. It
              renders nothing at all until a signed-in user opens it. */}
          <CommandPalette />
          {/* The `?` map. Mounted beside the palette for the same reason: the two
              are one story — the palette does anything by name, the map teaches
              the keys that do the common things without it. Renders nothing until
              the key is pressed. */}
          <ShortcutsHelp />
          <Toaster />
        </MotionPreferencesProvider>
      </body>
    </html>
  )
}

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={cn("font-sans")}>
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body className={cn("text-gray-900 antialiased min-h-screen bg-transparent")}>
        <ColorBendsLayer />
        <SecurityInitializer />
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

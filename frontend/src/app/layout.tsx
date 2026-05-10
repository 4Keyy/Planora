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

export const metadata = {
  title: "Planora | Private Shared Tasks",
  description: "Private shared tasks for friends and family with secure sessions, messaging, and accountability.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={cn("font-sans")}>
      <head>
        <meta name="google" content="notranslate" />
      </head>
      <body className={cn("text-gray-900 antialiased min-h-screen bg-transparent")}>
        <ColorBendsLayer />
        <SecurityInitializer />
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
        <Toaster />
      </body>
    </html>
  )
}

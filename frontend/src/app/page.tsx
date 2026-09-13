"use client"

import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { EASE_OUT_EXPO } from "@/lib/animations"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, CheckSquare, MessageCircle, ShieldCheck, Users } from "lucide-react"
import { useAuthStore } from "@/store/auth"

const features = [
  { icon: ShieldCheck, title: "Privacy-first sharing", desc: "Per-viewer redaction — show exactly what each person should see, nothing more." },
  { icon: Users, title: "Friends & family", desc: "Invite by email. Share household tasks, travel plans, or anything life throws at you." },
  { icon: MessageCircle, title: "In-context messages", desc: "Talk about a task right next to it — no context lost across channels." },
  { icon: CheckSquare, title: "Secure by default", desc: "Memory-only access tokens, httpOnly refresh cookies, CSRF protection, and short-lived sessions." },
]

const HERO_TRANSITION = { duration: 0.4, ease: EASE_OUT_EXPO }
const FEATURES_TRANSITION = { duration: 0.4, delay: 0.08, ease: EASE_OUT_EXPO }

export default function HomePage() {
  const router = useRouter()
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleCta = () => {
    const valid = useAuthStore.getState().isTokenValid()
    if (isAuthenticated && valid) router.push("/dashboard")
    else router.push("/auth/login")
  }

  // Prevent hydration mismatch by only rendering client-specific content after mount
  const ctaText = mounted && isAuthenticated ? "Open Dashboard" : "Start for free"

  return (
    <div className="min-h-screen bg-transparent flex flex-col">
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-4 pb-5 max-w-6xl mx-auto w-full sticky top-0 z-20"
        style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top, 0px))" }}
      >
        <span className="text-body font-bold tracking-tight text-ink">Planora</span>
        <div className="flex items-center gap-3">
          <Link href="/auth/login" className="text-body-sm text-ink-subtle hover:text-ink transition-colors px-3 py-1.5" suppressHydrationWarning>
            Sign in
          </Link>
          <Link
            href="/auth/register"
            className="text-body-sm font-medium bg-gray-900 text-paper px-4 py-2 rounded-lg hover:bg-gray-700 transition-colors"
            suppressHydrationWarning
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex-1 flex flex-col">
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-16 sm:py-24 max-w-4xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={HERO_TRANSITION}
          className="space-y-8"
        >
          <div className="inline-flex items-center gap-2 bg-paper/70 backdrop-blur-sm border border-line rounded-full px-4 py-1.5 text-caption font-semibold text-ink-muted uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            Private coordination, beautifully designed
          </div>

          <h1 className="text-display-sm sm:text-hero md:text-hero font-bold text-ink leading-[1.08] sm:leading-[1.05] tracking-tight text-balance">
            Real life needs
            <br />
            <span className="text-ink-subtle">real coordination.</span>
          </h1>

          <p className="text-title-sm sm:text-title-sm text-ink-subtle max-w-xl mx-auto leading-relaxed">
            Planora is a private task workspace for people who matter to you — share selectively, coordinate without noise, stay secure across every session.
          </p>

          <div className="flex w-full flex-col items-stretch justify-center gap-3 pt-2 sm:w-auto sm:flex-row sm:items-center">
            <button
              onClick={handleCta}
              className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gray-900 px-7 py-3.5 text-body-sm font-semibold text-paper shadow-lg shadow-gray-900/10 transition-[background-color,transform] duration-base hover:bg-gray-800 active:scale-[0.99]"
              suppressHydrationWarning
            >
              {ctaText}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </button>
            <Link
              href="/auth/register"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-line px-7 py-3.5 text-body-sm font-medium text-ink-muted transition-[background-color,border-color] duration-base hover:border-line-strong hover:bg-paper-sunken"
            >
              Create account
            </Link>
          </div>
        </motion.div>

        {/* Features grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, y: 0 }}
          transition={FEATURES_TRANSITION}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-16 sm:mt-24 w-full text-left"
        >
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-white/60 bg-paper/50 backdrop-blur-sm p-5 hover:bg-paper/80 hover:border-white hover:shadow-md transition-[background-color,border-color,box-shadow,backdrop-filter] duration-base group"
            >
              <div className="h-9 w-9 rounded-lg bg-paper border border-line flex items-center justify-center mb-4 shadow-sm group-hover:shadow-md transition-[box-shadow] duration-base">
                <f.icon className="h-4 w-4 text-ink-muted" />
              </div>
              <p className="text-body-sm font-semibold text-ink mb-1">{f.title}</p>
              <p className="text-caption text-ink-subtle leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </motion.div>
      </section>
      </main>

      {/* Footer */}
      <footer className="py-6 text-center text-caption text-ink-subtle border-t border-white/60">
        © {mounted ? new Date().getFullYear() : "2026"} Planora. Private coordination for people you trust.
      </footer>
    </div>
  )
}

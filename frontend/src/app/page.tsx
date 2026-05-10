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
      <nav className="flex items-center justify-between px-4 py-5 max-w-6xl mx-auto w-full sticky top-0 z-20">
        <span className="text-base font-bold tracking-tight text-gray-900">Planora</span>
        <div className="flex items-center gap-3">
          <Link href="/auth/login" className="text-sm text-gray-500 hover:text-gray-900 transition-colors px-3 py-1.5" suppressHydrationWarning>
            Sign in
          </Link>
          <Link
            href="/auth/register"
            className="text-sm font-medium bg-gray-900 text-white px-4 py-2 rounded-xl hover:bg-gray-700 transition-colors"
            suppressHydrationWarning
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="flex-1 flex flex-col items-center justify-center text-center px-4 py-24 max-w-4xl mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={HERO_TRANSITION}
          className="space-y-8"
        >
          <div className="inline-flex items-center gap-2 bg-white/70 backdrop-blur-sm border border-gray-200 rounded-full px-4 py-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wider">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Private coordination, beautifully designed
          </div>

          <h1 className="text-6xl sm:text-7xl font-bold text-gray-900 leading-[1.05] tracking-tight">
            Real life needs
            <br />
            <span className="text-gray-400">real coordination.</span>
          </h1>

          <p className="text-xl text-gray-500 max-w-xl mx-auto leading-relaxed">
            Planora is a private task workspace for people who matter to you — share selectively, coordinate without noise, stay secure across every session.
          </p>

          <div className="flex items-center justify-center gap-3 pt-2">
            <button
              onClick={handleCta}
              className="inline-flex items-center gap-2 bg-gray-900 text-white px-7 py-3.5 rounded-2xl text-sm font-semibold hover:bg-gray-700 transition-all duration-200 shadow-lg shadow-gray-900/10"
              suppressHydrationWarning
            >
              {ctaText}
              <ArrowRight className="h-4 w-4" />
            </button>
            <Link
              href="/auth/register"
              className="inline-flex items-center gap-2 text-gray-600 px-7 py-3.5 rounded-2xl text-sm font-medium border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-all duration-200"
            >
              Create account
            </Link>
          </div>
        </motion.div>

        {/* Features grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={FEATURES_TRANSITION}
          className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-24 w-full text-left"
        >
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-white/60 bg-white/50 backdrop-blur-sm p-5 hover:bg-white/80 hover:border-white hover:shadow-md transition-[background-color,border-color,box-shadow,backdrop-filter] duration-200 group"
            >
              <div className="h-9 w-9 rounded-xl bg-white border border-gray-100 flex items-center justify-center mb-4 shadow-sm group-hover:shadow-md transition-[box-shadow] duration-200">
                <f.icon className="h-4 w-4 text-gray-700" />
              </div>
              <p className="text-sm font-semibold text-gray-900 mb-1">{f.title}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-gray-400 border-t border-white/60">
        © {new Date().getFullYear()} Planora. Private coordination for people you trust.
      </footer>
    </div>
  )
}

"use client"

import { Suspense, lazy, useEffect, useState } from "react"
import { ErrorBoundary } from "@/components/error-boundary"

const ColorBends = lazy(() =>
  import("./color-bends").then(m => ({ default: m.ColorBends }))
)

/**
 * T4.10 — heuristically pick the cheapest fragment-shader iteration count that
 * still looks reasonable on the current device. Low-end mobile (≤2 logical
 * cores) gets 1 iteration; a typical laptop (4–7) gets 2; desktop/workstation
 * (≥8) gets 3 for the richer ribboning.
 *
 * Read once, after mount, inside the same effect that flips the layer to the
 * live shader (see ColorBendsLayer). The shader is only mounted with this value
 * already known, so the renderer never rebuilds for an iteration change.
 */
function detectIterations(): number {
  if (typeof navigator === "undefined") return 1
  const cores = typeof navigator.hardwareConcurrency === "number"
    ? navigator.hardwareConcurrency
    : 4
  if (cores >= 8) return 3
  if (cores >= 4) return 2
  return 1
}

/**
 * PERF: the live background pulls in three.js (~500 kB of JS) and runs a
 * continuous full-screen WebGL render loop. On phones/tablets that is pure cost
 * — there is no mouse to drive the parallax, and the constant GPU work drains
 * battery and causes scroll jank. Touch / small-viewport / Save-Data clients
 * therefore keep the static CSS gradient in the same palette: the lazy three.js
 * chunk is never fetched and no animation frame ever runs. Desktops (fine
 * pointer, wide viewport) upgrade to the full live shader after mount.
 *
 * Read once, after mount (see ColorBendsLayer) — never during render, so the
 * server and the first client paint always agree (both show the static
 * gradient) and React never reports a hydration mismatch.
 */
function prefersLightweightBackground(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean }
    deviceMemory?: number
  }
  // Explicit data-saver opt-out.
  if (nav.connection?.saveData) return true
  // Weak hardware: a continuous full-screen shader steals frames from the rest of
  // the UI on low-memory (≤2 GB) or low-core (≤2) machines, so they get the static
  // gradient instead — this is what keeps the app smooth on the weakest devices.
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 2) return true
  if (typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 2) return true
  // Touch / phones / tablets: no mouse parallax to justify the GPU + battery cost.
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false
  const smallViewport = window.innerWidth <= 768
  return coarsePointer || smallViewport
}

/** Static, GPU-cheap approximation of the ColorBends palette for mobile. */
const STATIC_BACKGROUND =
  "radial-gradient(120% 85% at 12% 0%, rgba(158,158,158,0.12), transparent 60%)," +
  "radial-gradient(110% 90% at 100% 100%, rgba(97,97,97,0.10), transparent 55%)," +
  "linear-gradient(158deg, rgba(212,212,212,0.14), rgba(255,255,255,0) 70%)"

/** Static gradient fallback element — visually equivalent to the live shader's palette. */
const StaticBackground = (
  <div className="w-full h-full" style={{ background: STATIC_BACKGROUND }} aria-hidden="true" />
)

/** Drop once into the root layout — gives every page the ColorBends background. */
export function ColorBendsLayer() {
  // HYDRATION: the server has no `navigator`/`window`, so it can only ever render
  // the static gradient. To guarantee the first client paint matches that markup
  // byte-for-byte, this component ALSO starts in the static state on every client
  // — `live` is false until the post-mount effect below decides the device is a
  // capable, non-touch desktop. Branching on device capabilities during render
  // (the previous approach) made the server emit <Suspense> while a mobile client
  // emitted the static <div>, which is exactly the mismatch React was flagging.
  const [live, setLive] = useState(false)
  const [iterations, setIterations] = useState(1)

  useEffect(() => {
    if (prefersLightweightBackground()) return // phones/tablets/save-data stay static
    setIterations(detectIterations())
    setLive(true)
  }, [])

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      {!live ? (
        StaticBackground
      ) : (
        // RESILIENCE: the live background lazy-loads the three.js chunk. If that
        // chunk fails to load (stale .next cache after a dev-server restart, a
        // flaky network, or an HTTP proxy mangling the `/_next/*` request), the
        // thrown ChunkLoadError must NOT take down the whole app — this layer
        // renders before the layout's main ErrorBoundary, so without a local
        // boundary the failure crashes every page (see layout.tsx). The decorative
        // background degrades to the same static gradient mobile already uses.
        <ErrorBoundary fallback={StaticBackground}>
          <Suspense fallback={StaticBackground}>
            <ColorBends
              colors={["#d4d4d4", "#9e9e9e", "#616161"]}
              rotation={-65}
              speed={0.36}
              scale={1.4}
              frequency={1}
              warpStrength={1}
              mouseInfluence={0.8}
              noise={0}
              parallax={0.65}
              iterations={iterations}
              intensity={1.2}
              bandWidth={6}
              transparent
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  )
}

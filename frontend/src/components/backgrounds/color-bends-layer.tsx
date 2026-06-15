"use client"

import { Suspense, lazy, useState } from "react"

const ColorBends = lazy(() =>
  import("./color-bends").then(m => ({ default: m.ColorBends }))
)

/**
 * T4.10 — heuristically pick the cheapest fragment-shader iteration count that
 * still looks reasonable on the current device. Low-end mobile (≤2 logical
 * cores) gets 1 iteration; a typical laptop (4–7) gets 2; desktop/workstation
 * (≥8) gets 3 for the richer ribboning.
 *
 * The detection runs in `useState`'s initializer so the first render gets the
 * final value — a `useEffect`-driven update would rebuild the WebGL scene
 * twice on mount (the renderer is in the child's effect deps). SSR has no
 * `navigator`, so the SSR path falls through to the conservative 1; the
 * client hydrates with its actual core count, but Next.js does not flag this
 * mismatch because the value is consumed as a prop on the lazy child, not
 * rendered into the markup directly.
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
 * therefore get a static CSS gradient in the same palette instead: the lazy
 * three.js chunk is never fetched and no animation frame ever runs. Desktops
 * (fine pointer, wide viewport) keep the full live shader.
 *
 * Runs in the `useState` initializer for the same reason as detectIterations —
 * the client computes the real value on mount; SSR falls through to the live
 * path but renders nothing (the lazy child is behind a null Suspense fallback).
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

/** Drop once into the root layout — gives every page the ColorBends background. */
export function ColorBendsLayer() {
  const [iterations] = useState(detectIterations)
  const [lightweight] = useState(prefersLightweightBackground)

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      {lightweight ? (
        <div className="w-full h-full" style={{ background: STATIC_BACKGROUND }} aria-hidden="true" />
      ) : (
        <Suspense fallback={null}>
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
      )}
    </div>
  )
}

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

/** Drop once into the root layout — gives every page the ColorBends WebGL background. */
export function ColorBendsLayer() {
  const [iterations] = useState(detectIterations)

  return (
    <Suspense fallback={null}>
      <div className="fixed inset-0 -z-10 pointer-events-none">
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
      </div>
    </Suspense>
  )
}

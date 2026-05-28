"use client"

import { Suspense, lazy, useEffect, useState } from "react"

const ColorBends = lazy(() =>
  import("./color-bends").then(m => ({ default: m.ColorBends }))
)

/**
 * T4.10 — heuristically pick the cheapest fragment-shader iteration count that
 * still looks reasonable on the current device. Low-end mobile (≤2 logical
 * cores) gets 1 iteration; a typical laptop (4–7) gets 2; desktop/workstation
 * (≥8) gets 3 for the richer ribboning. Always returns 1 during SSR (no
 * `navigator`) and on first paint, so hydration is deterministic. The runtime
 * upgrade happens silently on mount.
 */
function useAdaptiveIterations(): number {
  const [iterations, setIterations] = useState(1)

  useEffect(() => {
    const cores = typeof navigator !== "undefined"
      && typeof navigator.hardwareConcurrency === "number"
      ? navigator.hardwareConcurrency
      : 4
    if (cores >= 8) setIterations(3)
    else if (cores >= 4) setIterations(2)
    else setIterations(1)
  }, [])

  return iterations
}

/** Drop once into the root layout — gives every page the ColorBends WebGL background. */
export function ColorBendsLayer() {
  const iterations = useAdaptiveIterations()

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

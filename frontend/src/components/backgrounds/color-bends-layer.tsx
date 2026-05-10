"use client"

import { Suspense, lazy } from "react"

const ColorBends = lazy(() =>
  import("./color-bends").then(m => ({ default: m.ColorBends }))
)

/** Drop once into the root layout — gives every page the ColorBends WebGL background. */
export function ColorBendsLayer() {
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
          iterations={2}
          intensity={1.2}
          bandWidth={6}
          transparent
        />
      </div>
    </Suspense>
  )
}

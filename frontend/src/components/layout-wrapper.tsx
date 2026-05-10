'use client'

import { ReactNode } from 'react'
import FaultyTerminal from '@/components/faulty-terminal'

export function LayoutWrapper({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" style={{ filter: "blur(2px)" }}>
        <FaultyTerminal
          scale={2.9}
          digitSize={1.2}
          timeScale={0.1}
          noiseAmp={0.5}
          brightness={0.6}
          scanlineIntensity={0.5}
          curvature={0.3}
          mouseStrength={0.2}
          mouseReact={true}
          pageLoadAnimation={true}
          tint="#ffffff"
        />
      </div>
      <div className="relative z-10">{children}</div>
    </>
  )
}

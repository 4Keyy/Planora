"use client"

import { useEffect, useRef } from "react"
import {
  Clock,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"

// ─── Shader ──────────────────────────────────────────────────────────────────

const MAX_COLORS = 8

const FRAG = /* glsl */ `
#define MAX_COLORS ${MAX_COLORS}
uniform vec2  uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2  uRot;
uniform int   uColorCount;
uniform vec3  uColors[MAX_COLORS];
uniform int   uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2  uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int   uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p  = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q  = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  q += (uPointer - rp) * uMouseInfluence * 0.2;

  for (int j = 0; j < 5; j++) {
    if (j >= uIterations - 1) break;
    vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
    q += (rr - q) * 0.15;
  }

  vec3  col   = vec3(0.0);
  float a     = 1.0;

  if (uColorCount > 0) {
    vec2  s      = q;
    vec3  sumCol = vec3(0.0);
    float cover  = 0.0;
    for (int i = 0; i < MAX_COLORS; ++i) {
      if (i >= uColorCount) break;
      s -= 0.01;
      vec2  r      = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
      float m0     = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float kBelow = clamp(uWarpStrength, 0.0, 1.0);
      float kMix   = pow(kBelow, 0.3);
      float gain   = 1.0 + max(uWarpStrength - 1.0, 0.0);
      vec2  disp   = (r - s) * kBelow;
      vec2  warped = s + disp * gain;
      float m1     = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
      float m      = mix(m0, m1, kMix);
      float w      = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
      sumCol += uColors[i] * w;
      cover   = max(cover, w);
    }
    col = clamp(sumCol, 0.0, 1.0);
    a   = uTransparent > 0 ? cover : 1.0;
  } else {
    vec2 s = q;
    for (int k = 0; k < 3; ++k) {
      s -= 0.01;
      vec2  r      = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
      float m0     = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(k)) / 4.0);
      float kBelow = clamp(uWarpStrength, 0.0, 1.0);
      float kMix   = pow(kBelow, 0.3);
      float gain   = 1.0 + max(uWarpStrength - 1.0, 0.0);
      vec2  disp   = (r - s) * kBelow;
      vec2  warped = s + disp * gain;
      float m1     = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(k)) / 4.0);
      float m      = mix(m0, m1, kMix);
      col[k]       = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
    }
    a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
  }

  col *= uIntensity;

  if (uNoise > 0.0001) {
    float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
    col += (n - 0.5) * uNoise;
    col  = clamp(col, 0.0, 1.0);
  }

  vec3 rgb = (uTransparent > 0) ? col * a : col;
  gl_FragColor = vec4(rgb, a);
}
`

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ColorBendsProps {
  colors?:         string[]
  rotation?:       number
  autoRotate?:     number
  speed?:          number
  transparent?:    boolean
  scale?:          number
  frequency?:      number
  warpStrength?:   number
  mouseInfluence?: number
  parallax?:       number
  noise?:          number
  iterations?:     number
  intensity?:      number
  bandWidth?:      number
  className?:      string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function hexToVec3(hex: string): Vector3 {
  const h = hex.replace("#", "").trim()
  const full = h.length === 3
    ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  return new Vector3(full[0] / 255, full[1] / 255, full[2] / 255)
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ColorBends({
  colors        = [],
  rotation      = 90,
  autoRotate    = 0,
  speed         = 0.2,
  transparent   = true,
  scale         = 1,
  frequency     = 1,
  warpStrength  = 1,
  mouseInfluence = 1,
  parallax      = 0.5,
  noise         = 0.15,
  iterations    = 1,
  intensity     = 1.5,
  bandWidth     = 6,
  className     = "",
}: ColorBendsProps) {
  const containerRef    = useRef<HTMLDivElement>(null)
  const rotationRef     = useRef(rotation)
  const autoRotateRef   = useRef(autoRotate)
  const ptrTargetRef    = useRef(new Vector2(0, 0))
  const ptrCurrentRef   = useRef(new Vector2(0, 0))
  const materialRef     = useRef<ShaderMaterial | null>(null)
  const rendererRef     = useRef<WebGLRenderer | null>(null)
  const rafRef          = useRef<number | null>(null)

  // ── Main effect: scene setup, render loop ──────────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    // Scene
    const scene    = new Scene()
    const camera   = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
    const geometry = new PlaneGeometry(2, 2)

    const uColorsArr = Array.from({ length: MAX_COLORS }, () => new Vector3())
    const uniforms = {
      uCanvas:        { value: new Vector2(1, 1)    },
      uTime:          { value: 0                     },
      uSpeed:         { value: speed                 },
      uRot:           { value: new Vector2(1, 0)     },
      uColorCount:    { value: 0                     },
      uColors:        { value: uColorsArr            },
      uTransparent:   { value: transparent ? 1 : 0  },
      uScale:         { value: scale                 },
      uFrequency:     { value: frequency             },
      uWarpStrength:  { value: warpStrength          },
      uPointer:       { value: new Vector2(0, 0)     },
      uMouseInfluence:{ value: mouseInfluence        },
      uParallax:      { value: parallax              },
      uNoise:         { value: noise                 },
      uIterations:    { value: iterations            },
      uIntensity:     { value: intensity             },
      uBandWidth:     { value: bandWidth             },
    }

    const material = new ShaderMaterial({
      vertexShader:      VERT,
      fragmentShader:    FRAG,
      uniforms,
      premultipliedAlpha: true,
      transparent:       true,
    })
    materialRef.current = material

    scene.add(new Mesh(geometry, material))

    const renderer = new WebGLRenderer({
      antialias:        false,
      powerPreference:  "high-performance",
      alpha:            true,
    })
    rendererRef.current = renderer
    renderer.outputColorSpace = SRGBColorSpace
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x000000, transparent ? 0 : 1)
    Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" })
    container.appendChild(renderer.domElement)

    const clock = new Clock()
    let running = !reduceMotion

    const resize = () => {
      const w = container.clientWidth  || 1
      const h = container.clientHeight || 1
      renderer.setSize(w, h, false)
      uniforms.uCanvas.value.set(w, h)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()

    const loop = () => {
      const dt      = clock.getDelta()
      uniforms.uTime.value = clock.elapsedTime

      const deg = (rotationRef.current % 360) + autoRotateRef.current * clock.elapsedTime
      const rad = (deg * Math.PI) / 180
      uniforms.uRot.value.set(Math.cos(rad), Math.sin(rad))

      // Smooth pointer lerp
      ptrCurrentRef.current.lerp(ptrTargetRef.current, Math.min(1, dt * 8))
      uniforms.uPointer.value.copy(ptrCurrentRef.current)

      renderer.render(scene, camera)
      if (running) rafRef.current = requestAnimationFrame(loop)
    }

    if (reduceMotion) {
      // Single static frame
      clock.getDelta()
      uniforms.uTime.value = 0
      const rad = (rotation * Math.PI) / 180
      uniforms.uRot.value.set(Math.cos(rad), Math.sin(rad))
      renderer.render(scene, camera)
    } else {
      rafRef.current = requestAnimationFrame(loop)
    }

    const onVis = () => {
      if (reduceMotion) return
      if (document.visibilityState === "hidden") {
        running = false
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      } else {
        running = true
        rafRef.current = requestAnimationFrame(loop)
      }
    }
    document.addEventListener("visibilitychange", onVis)

    return () => {
      running = false
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      document.removeEventListener("visibilitychange", onVis)
      geometry.dispose()
      material.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandWidth, frequency, intensity, iterations, mouseInfluence, noise, parallax, scale, speed, transparent, warpStrength])

  // ── Uniform sync (lightweight, no scene rebuild) ───────────────────────────
  useEffect(() => {
    rotationRef.current   = rotation
    autoRotateRef.current = autoRotate

    const mat = materialRef.current
    const rdr = rendererRef.current
    if (!mat) return

    mat.uniforms.uSpeed.value          = speed
    mat.uniforms.uScale.value          = scale
    mat.uniforms.uFrequency.value      = frequency
    mat.uniforms.uWarpStrength.value   = warpStrength
    mat.uniforms.uMouseInfluence.value = mouseInfluence
    mat.uniforms.uParallax.value       = parallax
    mat.uniforms.uNoise.value          = noise
    mat.uniforms.uIterations.value     = iterations
    mat.uniforms.uIntensity.value      = intensity
    mat.uniforms.uBandWidth.value      = bandWidth
    mat.uniforms.uTransparent.value    = transparent ? 1 : 0
    if (rdr) rdr.setClearColor(0x000000, transparent ? 0 : 1)

    const vecs = (colors || []).filter(Boolean).slice(0, MAX_COLORS).map(hexToVec3)
    for (let i = 0; i < MAX_COLORS; i++) {
      const v = mat.uniforms.uColors.value[i] as Vector3
      if (i < vecs.length) v.copy(vecs[i]); else v.set(0, 0, 0)
    }
    mat.uniforms.uColorCount.value = vecs.length
  }, [rotation, autoRotate, speed, scale, frequency, warpStrength, mouseInfluence, parallax, noise, iterations, intensity, bandWidth, colors, transparent])

  // ── Global pointer tracking (works even with pointer-events-none) ──────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      ptrTargetRef.current.set(
        ((e.clientX - rect.left)  / (rect.width  || 1)) * 2 - 1,
       -(((e.clientY - rect.top) / (rect.height || 1)) * 2 - 1),
      )
    }
    window.addEventListener("pointermove", onMove, { passive: true })
    return () => window.removeEventListener("pointermove", onMove)
  }, [])

  return (
    <div
      ref={containerRef}
      className={`w-full h-full overflow-hidden${className ? ` ${className}` : ""}`}
    />
  )
}

"use client"

import { useEffect, useRef } from "react"

/**
 * Animated ribbon background, drawn with raw WebGL.
 *
 * This used to be a three.js scene. three.js is a scene graph — cameras, meshes,
 * materials, a render loop that traverses all of it — and none of that was in use
 * here: the whole effect is ONE fragment shader over ONE screen-filling quad, with
 * no depth, no lighting, no second object to sort against. The library cost 506 kB
 * of JavaScript to supply a vertex buffer and a uniform setter, and it was the
 * single largest dependency in the bundle.
 *
 * The shader below is byte-for-byte the shader that ran before; only the ~90 lines
 * of plumbing changed. Two preamble differences are all that raw GL requires:
 * three.js injected `precision highp float` into every fragment shader and declared
 * the `position` and `uv` attributes, so both are written out explicitly here.
 *
 * Deliberately WebGL 1, not 2: the shader is GLSL ES 1.00 (`varying`, `gl_FragColor`)
 * and gains nothing from GLSL 3.00, while WebGL 1 is supported by a wider set of
 * older GPUs and drivers. A context that fails to create returns null and the layer
 * above falls back to the static CSS gradient — the same path a lost context takes.
 */

const MAX_COLORS = 8

const FRAG = /* glsl */ `
precision highp float;
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
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
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

/** An RGB triple in 0..1, the form the `uColors` uniform array wants. */
export type Rgb = [number, number, number]

/**
 * `#abc` or `#aabbcc` (with or without the hash) to a 0..1 RGB triple.
 *
 * Anything else returns mid-grey rather than NaN. This is not defensiveness for its own
 * sake: the layer above shipped `var(--pl-line-strong)` here for a while, which parsed
 * to `[NaN, NaN, NaN]`, uploaded cleanly through `uniform3fv`, and produced a broken
 * background with no error anywhere. A uniform cannot resolve a CSS custom property —
 * WebGL never sees the cascade — so the failure has to be visible at the boundary.
 */
export function hexToVec3(hex: string): Rgb {
  const h = hex.replace("#", "").trim()
  if (!/^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h)) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`ColorBends: "${hex}" is not a hex colour. A uniform cannot resolve a CSS variable.`)
    }
    return [0.5, 0.5, 0.5]
  }
  const full = h.length === 3
    ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  return [full[0] / 255, full[1] / 255, full[2] / 255]
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, source)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    // A compile failure is a developer error, not a user-facing one: report it and
    // let the caller fall back to the static gradient rather than a blank canvas.
    console.error("ColorBends shader failed to compile:", gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

function link(gl: WebGLRenderingContext, vert: string, frag: string): WebGLProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, vert)
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  // The shaders belong to the program once linked; dropping our handles here means
  // a later dispose only has to delete the program.
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error("ColorBends program failed to link:", gl.getProgramInfoLog(prog))
    gl.deleteProgram(prog)
    return null
  }
  return prog
}

/** Every uniform the fragment shader declares, resolved once at link time. */
type Uniforms = Record<string, WebGLUniformLocation | null>

const UNIFORM_NAMES = [
  "uCanvas", "uTime", "uSpeed", "uRot", "uColorCount", "uColors", "uTransparent",
  "uScale", "uFrequency", "uWarpStrength", "uPointer", "uMouseInfluence",
  "uParallax", "uNoise", "uIterations", "uIntensity", "uBandWidth",
] as const

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
  const containerRef  = useRef<HTMLDivElement>(null)
  const rotationRef   = useRef(rotation)
  const autoRotateRef = useRef(autoRotate)
  // Pointer in clip space: where it is, and where the render loop has eased to.
  const ptrTargetRef  = useRef<[number, number]>([0, 0])
  const ptrCurrentRef = useRef<[number, number]>([0, 0])
  // Live GL handles, so the cheap uniform-sync effect can reach them without
  // tearing down and rebuilding the context.
  const glRef   = useRef<WebGLRenderingContext | null>(null)
  const progRef = useRef<WebGLProgram | null>(null)
  const uRef    = useRef<Uniforms>({})
  const drawRef = useRef<(() => void) | null>(null)
  const rafRef  = useRef<number | null>(null)

  // ── Main effect: context, program, render loop ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // The shader owns its own reduced-motion handling: neither the CSS rule in
    // globals.css nor framer-motion's MotionConfig can reach a requestAnimationFrame
    // loop. Below it renders one static frame and never starts the loop.
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    let reduceMotion = motionQuery.matches

    const canvas = document.createElement("canvas")
    Object.assign(canvas.style, { width: "100%", height: "100%", display: "block" })

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // The shader emits premultiplied RGB (`col * a`), which is what the compositor
      // is told to expect here. Mismatching the two is the classic cause of a halo
      // around a transparent WebGL layer.
      premultipliedAlpha: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    }) as WebGLRenderingContext | null

    // No WebGL (old driver, blocklisted GPU, jsdom under test): leave the container
    // empty. The layer above is already showing the static CSS gradient.
    if (!gl) return

    const prog = link(gl, VERT, FRAG)
    if (!prog) return

    container.appendChild(canvas)
    glRef.current = gl
    progRef.current = prog

    const u: Uniforms = {}
    for (const name of UNIFORM_NAMES) u[name] = gl.getUniformLocation(prog, name)
    uRef.current = u

    // One screen-filling quad as a triangle strip: four vertices, no index buffer.
    // `uv` runs 0..1 so the fragment shader's `vUv` matches what three.js produced
    // for a PlaneGeometry.
    const quad = new Float32Array([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ])
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)

    const aPosition = gl.getAttribLocation(prog, "position")
    const aUv       = gl.getAttribLocation(prog, "uv")
    gl.useProgram(prog)
    gl.enableVertexAttribArray(aPosition)
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(aUv)
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8)

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.clearColor(0, 0, 0, transparent ? 0 : 1)

    // Static uniforms — the ones that only change when this effect re-runs.
    gl.uniform1f(u.uSpeed!, speed)
    gl.uniform1f(u.uScale!, scale)
    gl.uniform1f(u.uFrequency!, frequency)
    gl.uniform1f(u.uWarpStrength!, warpStrength)
    gl.uniform1f(u.uMouseInfluence!, mouseInfluence)
    gl.uniform1f(u.uParallax!, parallax)
    gl.uniform1f(u.uNoise!, noise)
    gl.uniform1i(u.uIterations!, iterations)
    gl.uniform1f(u.uIntensity!, intensity)
    gl.uniform1f(u.uBandWidth!, bandWidth)
    gl.uniform1i(u.uTransparent!, transparent ? 1 : 0)

    const start = performance.now()
    let last = start
    let running = false

    const draw = () => {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const elapsed = reduceMotion ? 0 : (now - start) / 1000

      gl.uniform1f(u.uTime!, elapsed)

      const deg = (rotationRef.current % 360) + autoRotateRef.current * elapsed
      const rad = (deg * Math.PI) / 180
      gl.uniform2f(u.uRot!, Math.cos(rad), Math.sin(rad))

      // Smooth pointer easing, frame-rate independent.
      const cur = ptrCurrentRef.current
      const tgt = ptrTargetRef.current
      const k = Math.min(1, dt * 8)
      cur[0] += (tgt[0] - cur[0]) * k
      cur[1] += (tgt[1] - cur[1]) * k
      gl.uniform2f(u.uPointer!, cur[0], cur[1])

      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
    drawRef.current = draw

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const resize = () => {
      const w = container.clientWidth  || 1
      const h = container.clientHeight || 1
      const pw = Math.max(1, Math.round(w * dpr))
      const ph = Math.max(1, Math.round(h * dpr))
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }
      gl.viewport(0, 0, pw, ph)
      gl.uniform2f(u.uCanvas!, w, h)
      // A resize while the loop is parked (reduced motion, hidden tab) still has to
      // repaint, or the canvas keeps the old frame stretched to the new size.
      if (!running) draw()
    }

    const loop = () => {
      draw()
      if (running) rafRef.current = requestAnimationFrame(loop)
    }

    const ro = new ResizeObserver(resize)
    ro.observe(container)
    resize()

    if (reduceMotion) {
      draw()              // one static frame, no loop
    } else {
      running = true
      rafRef.current = requestAnimationFrame(loop)
    }

    const stop = () => {
      running = false
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    const onVis = () => {
      if (reduceMotion) return
      if (document.visibilityState === "hidden") {
        stop()
      } else if (rafRef.current === null) {
        running = true
        last = performance.now()
        rafRef.current = requestAnimationFrame(loop)
      }
    }
    document.addEventListener("visibilitychange", onVis)

    // The preference can change while the page is open — a system setting, not a
    // page load. Reading it once at mount left the loop running for anyone who
    // turned reduced motion on without reloading.
    const onMotionPreferenceChange = (e: MediaQueryListEvent) => {
      reduceMotion = e.matches
      if (e.matches) {
        stop()
        draw()
      } else if (rafRef.current === null && document.visibilityState !== "hidden") {
        running = true
        last = performance.now()
        rafRef.current = requestAnimationFrame(loop)
      }
    }
    motionQuery.addEventListener("change", onMotionPreferenceChange)

    /**
     * A GPU can take the context away at any time (driver reset, a tab backgrounded
     * long enough, machine sleep). Without this handler the canvas would keep its
     * last frame while every subsequent GL call silently no-ops. Preventing the
     * default lets the browser restore it; until then, stop drawing.
     */
    const onContextLost = (e: Event) => {
      e.preventDefault()
      stop()
    }
    canvas.addEventListener("webglcontextlost", onContextLost)

    return () => {
      stop()
      ro.disconnect()
      document.removeEventListener("visibilitychange", onVis)
      motionQuery.removeEventListener("change", onMotionPreferenceChange)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(prog)
      // Release the GPU allocation immediately rather than waiting for GC — a
      // browser only grants a handful of live WebGL contexts per page.
      gl.getExtension("WEBGL_lose_context")?.loseContext()
      glRef.current = null
      progRef.current = null
      drawRef.current = null
      if (canvas.parentElement === container) container.removeChild(canvas)
    }
  }, [bandWidth, frequency, intensity, iterations, mouseInfluence, noise, parallax, scale, speed, transparent, warpStrength])

  // ── Uniform sync (lightweight, no context rebuild) ─────────────────────────
  useEffect(() => {
    rotationRef.current   = rotation
    autoRotateRef.current = autoRotate

    const gl = glRef.current
    const prog = progRef.current
    const u = uRef.current
    if (!gl || !prog) return
    gl.useProgram(prog)

    const vecs = (colors || []).filter(Boolean).slice(0, MAX_COLORS).map(hexToVec3)
    // uColors is a vec3 array: one flat Float32Array of MAX_COLORS * 3, unused
    // slots zeroed. uColorCount is what actually bounds the shader's loop.
    const flat = new Float32Array(MAX_COLORS * 3)
    vecs.forEach((v, i) => { flat[i * 3] = v[0]; flat[i * 3 + 1] = v[1]; flat[i * 3 + 2] = v[2] })
    gl.uniform3fv(u.uColors!, flat)
    gl.uniform1i(u.uColorCount!, vecs.length)

    // Repaint immediately: when the loop is parked (reduced motion) a colour change
    // would otherwise not appear until the next resize.
    drawRef.current?.()
  }, [rotation, autoRotate, colors])

  // ── Global pointer tracking (works even with pointer-events-none) ──────────
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      ptrTargetRef.current = [
        ((e.clientX - rect.left)  / (rect.width  || 1)) * 2 - 1,
       -(((e.clientY - rect.top) / (rect.height || 1)) * 2 - 1),
      ]
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

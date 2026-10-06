import { createRef, useEffect } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { AnimatePresence, MotionConfig, motionValue, useAnimationControls } from "framer-motion"
import { afterEach, describe, expect, it, vi } from "vitest"
import { motion } from "@/components/ui/motion"

const nativeAnimation = vi.fn(function (this: Element) {
  const animation = {
    cancel: vi.fn(), play: vi.fn(), pause: vi.fn(), finish: vi.fn(), reverse: vi.fn(),
    addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    commitStyles: vi.fn(), persist: vi.fn(), updatePlaybackRate: vi.fn(),
    currentTime: 0, startTime: null, playbackRate: 1, playState: "running",
    pending: false, replaceState: "active", id: "", effect: null,
    onfinish: null, oncancel: null, onremove: null,
    finished: Promise.resolve(), ready: Promise.resolve(), timeline: null,
  }
  return animation as unknown as Animation
})
Element.prototype.animate = nativeAnimation

afterEach(() => nativeAnimation.mockClear())

describe("stable motion opacity", () => {
  it("completes opacity in the frame renderer instead of reverting a native animation", async () => {
    render(<motion.div data-testid="surface" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.05 }} />)
    await waitFor(() => expect(screen.getByTestId("surface").style.opacity).toBe("1"))
    expect(nativeAnimation).not.toHaveBeenCalled()
  })

  it("keeps ordinary CSS and numeric opacity when only geometry is animated", () => {
    const view = render(<motion.button data-testid="control" className="opacity-50" whileTap={{ scale: 0.97 }} />)
    expect(screen.getByTestId("control").style.opacity).toBe("")
    view.rerender(<motion.button data-testid="control" style={{ opacity: 0.45 }} whileTap={{ scale: 0.97 }} />)
    expect(screen.getByTestId("control").style.opacity).toBe("0.45")
    view.rerender(<motion.button data-testid="control" style={{ opacity: 0.65 }} whileTap={{ scale: 0.97 }} />)
    expect(screen.getByTestId("control").style.opacity).toBe("0.65")
  })

  it("uses the current numeric opacity as the resting target after hover", async () => {
    const view = render(<motion.div data-testid="hover" style={{ opacity: 0.45 }} whileHover={{ opacity: 0.8 }} transition={{ duration: 0 }} />)
    const node = screen.getByTestId("hover")
    fireEvent.pointerEnter(node)
    await waitFor(() => expect(node.style.opacity).toBe("0.8"))
    view.rerender(<motion.div data-testid="hover" style={{ opacity: 0.65 }} whileHover={{ opacity: 0.8 }} transition={{ duration: 0 }} />)
    expect(node.style.opacity).toBe("0.8")
    fireEvent.pointerLeave(node)
    await waitFor(() => expect(node.style.opacity).toBe("0.65"))
  })

  it("retains a CSS resting opacity before and after a hover fade", async () => {
    render(<><style>{`.resting-opacity { opacity: .5 }`}</style><motion.div data-testid="css-hover" className="resting-opacity" whileHover={{ opacity: 0.8 }} transition={{ duration: 0 }} /></>)
    const node = screen.getByTestId("css-hover")
    expect(getComputedStyle(node).opacity).toBe("0.5")
    fireEvent.pointerEnter(node)
    await waitFor(() => expect(getComputedStyle(node).opacity).toBe("0.8"))
    fireEvent.pointerLeave(node)
    await waitFor(() => expect(getComputedStyle(node).opacity).toBe("0.5"))
  })

  it("leaves CSS opacity alone when a dynamic variant only moves geometry", async () => {
    render(<><style>{`.dynamic-opacity { opacity: .4 }`}</style><motion.div data-testid="css-dynamic" className="dynamic-opacity" initial="hidden" animate="shown"
      variants={{ hidden: { y: 6 }, shown: () => ({ y: 0 }) }} transition={{ duration: 0.05 }} /></>)
    const node = screen.getByTestId("css-dynamic")
    expect(getComputedStyle(node).opacity).toBe("0.4")
    await waitFor(() => expect(node.style.transform).toBe("none"))
    expect(getComputedStyle(node).opacity).toBe("0.4")
    expect(node.style.opacity).toBe("")
  })

  it("does not override CSS opacity in the server markup", () => {
    const hover = renderToStaticMarkup(<motion.div className="opacity-50" whileHover={{ opacity: 0.8 }} />)
    expect(hover).not.toContain("opacity:")
    const geometry = renderToStaticMarkup(<motion.div className="opacity-40" initial="hidden" animate="shown" variants={{ hidden: { y: 6 }, shown: () => ({ y: 0 }) }} />)
    expect(geometry).not.toContain("opacity:")
    const visible = renderToStaticMarkup(<motion.div initial={false} animate={{ opacity: 0.85 }} />)
    expect(visible).toContain("opacity:0.85")
  })

  it("reads CSS before a dynamic opacity target without an initial opacity", async () => {
    render(<><style>{`.css-variant { opacity: .4 }`}</style><motion.div data-testid="css-variant" className="css-variant" animate="shown" variants={{ shown: () => ({ opacity: 0.8 }) }} transition={{ duration: 0.05 }} /></>)
    const node = screen.getByTestId("css-variant")
    expect(Number(getComputedStyle(node).opacity)).toBeLessThanOrEqual(0.4)
    await waitFor(() => expect(node.style.opacity).toBe("0.8"))
    expect(nativeAnimation).not.toHaveBeenCalled()
  })

  it("preserves an explicitly supplied opacity MotionValue", async () => {
    const opacity = motionValue(0.3)
    render(<motion.div data-testid="external" style={{ opacity }} />)
    expect(screen.getByTestId("external").style.opacity).toBe("0.3")
    act(() => opacity.set(0.7))
    await waitFor(() => expect(screen.getByTestId("external").style.opacity).toBe("0.7"))
  })

  it("does not replay an entrance when initial is false", () => {
    render(<motion.div data-testid="shown" initial={false} animate={{ opacity: 0.85 }} />)
    expect(screen.getByTestId("shown").style.opacity).toBe("0.85")
    expect(nativeAnimation).not.toHaveBeenCalled()
  })

  it("supports variant functions and preserves lifecycle callbacks", async () => {
    const complete = vi.fn()
    render(<motion.div data-testid="dynamic" custom={0.75} initial="hidden" animate="shown"
      variants={{ hidden: { opacity: 0 }, shown: (value: number) => ({ opacity: value }) }}
      transition={{ duration: 0.05 }} onAnimationComplete={complete} />)
    await waitFor(() => expect(screen.getByTestId("dynamic").style.opacity).toBe("0.75"))
    expect(complete.mock.calls[0]?.[0]).toBe("shown")
    expect(nativeAnimation).not.toHaveBeenCalled()
  })

  it("keeps the same DOM node and settled opacity through unrelated renders", async () => {
    const view = render(<motion.div data-testid="steady" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.05 }}>first</motion.div>)
    const node = screen.getByTestId("steady")
    await waitFor(() => expect(node.style.opacity).toBe("1"))
    view.rerender(<motion.div data-testid="steady" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.05 }}>second</motion.div>)
    expect(screen.getByTestId("steady")).toBe(node)
    expect(node.style.opacity).toBe("1")
    expect(nativeAnimation).not.toHaveBeenCalled()
  })

  it("keeps inherited variant entrances and forwards the DOM ref", async () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <motion.div initial="hidden" animate="visible">
        <motion.div ref={ref} data-testid="child" variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }} transition={{ duration: 0.05 }} />
      </motion.div>,
    )
    expect(ref.current).toBe(screen.getByTestId("child"))
    await waitFor(() => expect(ref.current?.style.opacity).toBe("1"))
    expect(nativeAnimation).not.toHaveBeenCalled()
  })

  it("supports imperative controls with the existing reduced-motion context", async () => {
    function Controlled() {
      const controls = useAnimationControls()
      useEffect(() => { void controls.start({ opacity: 1, y: 0 }, { duration: 0.05 }) }, [controls])
      return <motion.div data-testid="controlled" initial={{ opacity: 0, y: 15 }} animate={controls} />
    }
    render(<MotionConfig reducedMotion="always"><Controlled /></MotionConfig>)
    await waitFor(() => expect(screen.getByTestId("controlled").style.opacity).toBe("1"))
    expect(screen.getByTestId("controlled").style.transform).toBe("none")
    expect(nativeAnimation).not.toHaveBeenCalled()
  })

  it("finishes a popLayout exit and releases its DOM ref", async () => {
    const ref = createRef<HTMLDivElement>()
    const view = render(<AnimatePresence mode="popLayout"><motion.div key="card" ref={ref} data-testid="leaving" layout="position" initial={false} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.05 }} /></AnimatePresence>)
    view.rerender(<AnimatePresence mode="popLayout" />)
    expect(screen.getByTestId("leaving")).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId("leaving")).not.toBeInTheDocument())
    expect(ref.current).toBeNull()
    expect(nativeAnimation).not.toHaveBeenCalled()
  })
})

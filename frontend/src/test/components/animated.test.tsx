import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CompletionCelebration, SuccessPulse } from "@/components/animated/celebration"
import { FadeIn, ScaleIn, SlideIn, StaggerContainer, StaggerItem } from "@/components/animated/fade-in"
import {
  LoadingDots,
  LoadingOverlay,
  LoadingSpinner,
  SkeletonCard,
  SkeletonLoader,
} from "@/components/animated/loading"

const motionState = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock("framer-motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("framer-motion")>()
  return {
    ...actual,
    useReducedMotion: () => motionState.reducedMotion,
  }
})

describe("animated components", () => {
  beforeEach(() => {
    motionState.reducedMotion = false
  })

  it("renders fade, scale, slide, and stagger wrappers with children", () => {
    render(
      <div>
        <FadeIn className="fade">Fade child</FadeIn>
        <ScaleIn className="scale">Scale child</ScaleIn>
        <SlideIn direction="left" className="slide">Slide child</SlideIn>
        <StaggerContainer>
          <StaggerItem>Stagger child</StaggerItem>
        </StaggerContainer>
      </div>,
    )

    expect(screen.getByText("Fade child")).toBeInTheDocument()
    expect(screen.getByText("Scale child")).toBeInTheDocument()
    expect(screen.getByText("Slide child")).toBeInTheDocument()
    expect(screen.getByText("Stagger child")).toBeInTheDocument()
  })

  it("renders reduced-motion fallbacks for fade, stagger item, and slide wrappers", () => {
    motionState.reducedMotion = true

    render(
      <div>
        <FadeIn className="fade-reduced">Fade reduced</FadeIn>
        <StaggerItem className="stagger-reduced">Stagger reduced</StaggerItem>
        <SlideIn className="slide-reduced">Slide reduced</SlideIn>
      </div>,
    )

    expect(screen.getByText("Fade reduced")).toHaveClass("fade-reduced")
    expect(screen.getByText("Stagger reduced")).toHaveClass("stagger-reduced")
    expect(screen.getByText("Slide reduced")).toHaveClass("slide-reduced")
  })

  it("renders loading primitives and skeletons", () => {
    const { container } = render(
      <div>
        <LoadingSpinner size="sm" />
        <LoadingSpinner size="md" />
        <LoadingSpinner size="lg" />
        <LoadingDots />
        <SkeletonLoader className="h-4" />
        <SkeletonCard />
      </div>,
    )

    expect(container.querySelector(".h-4.w-4")).toBeInTheDocument()
    expect(container.querySelector(".h-6.w-6")).toBeInTheDocument()
    expect(container.querySelector(".h-8.w-8")).toBeInTheDocument()
    expect(container.querySelectorAll(".h-2.w-2")).toHaveLength(3)
    expect(container.querySelectorAll(".skeleton")).toHaveLength(6)
  })

  it("renders the blocking loading overlay", () => {
    render(<LoadingOverlay />)

    expect(screen.getByText("Loading...")).toBeInTheDocument()
  })

  it("renders celebrations only when requested", () => {
    const hidden = render(<CompletionCelebration show={false} />)

    expect(hidden.container.firstChild).toBeNull()
    hidden.unmount()

    const visible = render(<CompletionCelebration show />)

    expect(visible.container.querySelectorAll('[data-testid="confetti-piece"]')).toHaveLength(18)
    expect(visible.container.firstElementChild).toHaveClass("fixed")

    const inline = render(<CompletionCelebration show variant="card" />)

    expect(inline.container.firstElementChild).toHaveClass("absolute")
  })

  it("renders success pulse in center and inline modes", () => {
    const { container, rerender } = render(<SuccessPulse />)

    expect(container.firstElementChild).toHaveClass("inset-0")

    rerender(<SuccessPulse position="inline" />)

    expect(container.firstElementChild).not.toHaveClass("inset-0")
  })
})

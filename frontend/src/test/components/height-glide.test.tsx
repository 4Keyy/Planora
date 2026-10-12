import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SPRING_LAYOUT } from "@/lib/animations"

const glide = vi.hoisted(() => ({ calls: [] as Array<{ element: unknown; options: Record<string, unknown> }> }))

vi.mock("@/hooks/use-height-transition", () => ({
  useHeightTransition: (ref: { current: unknown }, options: Record<string, unknown>) => {
    glide.calls.push({ element: ref, options })
  },
}))

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => reduced.value,
}))

import { HeightGlide } from "@/components/ui/height-glide"

describe("HeightGlide", () => {
  it("glides its own height to its one child's, clipped below, on the layout spring", () => {
    glide.calls.length = 0
    render(
      <HeightGlide shape={2} className="grid-wrap" aria-busy>
        <p>cards</p>
      </HeightGlide>,
    )
    const outer = screen.getByText("cards").parentElement!.parentElement!
    expect(outer).toHaveClass("grid-wrap")
    expect(outer).toHaveAttribute("aria-busy", "true")
    // The content is the one in-flow child the glide measures.
    expect(outer.children).toHaveLength(1)
    const { options } = glide.calls.at(-1)!
    expect(options).toMatchObject({ shape: 2, spring: SPRING_LAYOUT, disabled: false, clipBelow: true })
    expect((options.content as { current: Element }).current).toBe(outer.firstElementChild)
  })

  it("changes in one step under reduced motion", () => {
    reduced.value = true
    glide.calls.length = 0
    render(<HeightGlide shape={1}>cards</HeightGlide>)
    expect(glide.calls.at(-1)!.options).toMatchObject({ disabled: true })
    reduced.value = false
  })
})

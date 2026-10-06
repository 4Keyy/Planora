import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { DropletFrame } from "@/components/layout/droplet"

describe("DropletFrame", () => {
  it("slides the whole frame away on a phone without fading the glass", () => {
    const { container, rerender } = render(<DropletFrame hidden>bar</DropletFrame>)
    const frame = container.firstElementChild as HTMLElement
    const capsule = container.querySelector("header") as HTMLElement

    // The slide is a CSS translate on the plain wrapper, leaving on the symmetric curve:
    // the capsule's own transform belongs to framer's layout projection.
    expect(frame).toHaveClass("-translate-y-[calc(100%+2rem)]", "ease-standard", "duration-slow")
    // Opacity on an ancestor of the glass would make it a Backdrop Root and switch its blur off.
    expect(capsule.style.opacity).toBe("")

    rerender(<DropletFrame hidden={false}>bar</DropletFrame>)
    // At rest the frame carries no transform, so it never traps a fixed descendant.
    expect(frame.className).not.toContain("translate-y")
    expect(frame).toHaveClass("ease-emphasized")
    expect(capsule.style.opacity).toBe("")
  })
})

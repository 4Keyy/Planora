import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The route fade, first page versus every page after it.
 *
 * It used to start every page at `opacity: 0`, which framer-motion writes into the server
 * HTML — so every first visit was a blank page until hydration finished, and the landing
 * page's `h1` sometimes never became an LCP candidate at all. Each case starts a fresh
 * module-scoped visit and performs its own navigation setup.
 */
beforeEach(() => vi.resetModules())

describe("Template", () => {
  it("shows the first page of a visit at once, with nothing to fade in", async () => {
    const { default: Template } = await import("@/app/template")
    const { unmount } = render(
      <Template>
        <p>first page</p>
      </Template>,
    )
    const wrapper = screen.getByText("first page").parentElement as HTMLElement
    expect(wrapper.style.opacity).not.toBe("0")
    unmount()
  })

  it("fades in the pages reached by navigating inside the app", async () => {
    const { default: Template } = await import("@/app/template")
    const firstPage = render(<Template><p>previous page</p></Template>)
    firstPage.unmount()
    render(
      <Template>
        <p>next page</p>
      </Template>,
    )
    const wrapper = screen.getByText("next page").parentElement as HTMLElement
    expect(wrapper.style.opacity).toBe("0")
  })
})

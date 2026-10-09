import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import GlobalError from "@/app/global-error"
import { useAuthStore } from "@/store/auth"

vi.mock("@/components/command-palette", () => ({ requestPalette: vi.fn() }))

// The root boundary owns a complete document. Static rendering tests its shell
// without nesting <html>/<body> inside jsdom's existing body.
function documentFor(error: Error & { digest?: string }) {
  return new DOMParser().parseFromString(
    renderToStaticMarkup(<GlobalError error={error} reset={vi.fn()} />),
    "text/html",
  )
}

describe("GlobalError document", () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, hasHydrated: false })
    const report = console.error
    vi.spyOn(console, "error").mockImplementation((message, ...arguments_) => {
      // Client motion hooks are expected in this isolated static-render test.
      if (String(message).startsWith("Warning: useLayoutEffect does nothing on the server")) return
      if (message === "[app] route-level error") return
      report(message, ...arguments_)
    })
  })
  afterEach(() => {
    useAuthStore.setState({ isAuthenticated: false, hasHydrated: false })
    vi.restoreAllMocks()
  })

  it("renders an English document and a usable anonymous recovery scene", () => {
    const document = documentFor(new Error("private server stack"))

    expect(document.documentElement.lang).toBe("en")
    expect(document.body.classList.contains("bg-paper")).toBe(true)
    expect(document.querySelector("main[aria-labelledby='error-title']")).not.toBeNull()
    expect(document.querySelector("h1")?.textContent).toBe("This screen hit a snag.")
    expect(document.querySelector("button")?.textContent).toContain("Retry")
    expect(document.querySelector("a[href='/']")?.textContent).toContain("Planora home")
    expect(document.body.textContent).not.toContain("private server stack")
  })

  it("preserves the opaque digest while keeping internal details out of the document", () => {
    const document = documentFor(Object.assign(new Error("internal SQL credentials"), { digest: "stage-reference" }))

    expect(document.querySelector("code")?.textContent).toBe("stage-reference")
    expect(document.body.textContent).not.toContain("internal SQL credentials")
  })

  it("keeps its authenticated recovery destination and Retry usable after client mount", async () => {
    useAuthStore.setState({ isAuthenticated: true, hasHydrated: true })
    const reset = vi.fn()
    // Mount the actual boundary's scene in jsdom, after checking its document
    // shell above. This exercises CrashScene without mocking its implementation.
    const documentElement = GlobalError({ error: new Error("root layout failed"), reset })
    render(documentElement.props.children.props.children)

    expect(screen.getByRole("link", { name: /Back to dashboard/ })).toHaveAttribute("href", "/dashboard")
    expect(screen.queryByRole("link", { name: /Planora home/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }))
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
  })
})

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

describe("Button", () => {
  it("renders button children with default classes", () => {
    render(<Button>Save</Button>)

    const button = screen.getByRole("button", { name: "Save" })
    expect(button).toHaveClass("inline-flex")
    expect(button).toHaveClass("bg-ink")
  })

  it("supports variant and size class generation", () => {
    expect(buttonVariants({ variant: "destructive", size: "lg" })).toContain("bg-alert")
    expect(buttonVariants({ variant: "destructive", size: "lg" })).toContain("h-control-lg")
  })

  describe("loading", () => {
    it("blocks the button and announces the busy state", () => {
      render(<Button loading>Delete account</Button>)

      const button = screen.getByRole("button", { name: "Delete account" })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute("aria-busy", "true")
      expect(screen.getByTestId("button-spinner")).toBeInTheDocument()
    })

    it("keeps the label mounted so the button does not resize mid-action", () => {
      render(<Button loading>Save changes</Button>)

      // Hidden, not removed: an unmounted label would collapse the button's
      // width and reflow the row around it while the request is in flight.
      const label = screen.getByText("Save changes")
      expect(label).toBeInTheDocument()
      expect(label).toHaveClass("invisible")
    })

    it("stays interactive and shows no spinner when not loading", () => {
      render(<Button>Save changes</Button>)

      const button = screen.getByRole("button", { name: "Save changes" })
      expect(button).toBeEnabled()
      expect(button).not.toHaveAttribute("aria-busy")
      expect(screen.queryByTestId("button-spinner")).not.toBeInTheDocument()
    })

    it("respects an explicit disabled even when it is not loading", () => {
      render(<Button disabled>Save changes</Button>)
      expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled()
    })

    it("renders the child element untouched under asChild", () => {
      // asChild hands rendering to someone else — usually a Link — where a
      // spinner and a disabled attribute would be meaningless.
      render(
        <Button asChild>
          <a href="/tasks">Go to tasks</a>
        </Button>,
      )

      const link = screen.getByRole("link", { name: "Go to tasks" })
      expect(link).toHaveClass("inline-flex")
      expect(screen.queryByTestId("button-spinner")).not.toBeInTheDocument()
    })
  })
})

describe("Card components", () => {
  it("renders the full card composition", () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Dashboard</CardTitle>
          <CardDescription>Summary</CardDescription>
        </CardHeader>
        <CardContent>Content</CardContent>
        <CardFooter>Footer</CardFooter>
      </Card>,
    )

    expect(screen.getByTestId("card")).toHaveClass("rounded-xl")
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument()
    expect(screen.getByText("Summary")).toHaveClass("text-body-sm")
    expect(screen.getByText("Content")).toHaveClass("pt-0")
    expect(screen.getByText("Footer")).toHaveClass("items-center")
  })
})

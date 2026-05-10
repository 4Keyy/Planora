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
    expect(button).toHaveClass("bg-black")
  })

  it("supports variant and size class generation", () => {
    expect(buttonVariants({ variant: "destructive", size: "lg" })).toContain("bg-red-600")
    expect(buttonVariants({ variant: "destructive", size: "lg" })).toContain("h-12")
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

    expect(screen.getByTestId("card")).toHaveClass("rounded-2xl")
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument()
    expect(screen.getByText("Summary")).toHaveClass("text-sm")
    expect(screen.getByText("Content")).toHaveClass("pt-0")
    expect(screen.getByText("Footer")).toHaveClass("items-center")
  })
})

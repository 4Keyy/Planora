import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CreateTodoPanel } from "@/components/todos/create-todo-panel"
import type { Category } from "@/types/category"

vi.mock("@/hooks/use-friends", () => ({
  useFriends: () => [
    {
      id: "friend-1",
      email: "ada@example.com",
      firstName: "Ada",
      lastName: "Lovelace",
      friendsSince: "2026-05-01T00:00:00.000Z",
    },
  ],
}))

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
  parseApiResponse: (response: unknown) => {
    if (response && typeof response === "object" && "value" in response) return response.value
    if (response && typeof response === "object" && "data" in response) return response.data
    return response
  },
}))

const categories: Category[] = [
  { id: "cat-1", name: "Work", color: "#2563eb", icon: "Briefcase" },
]

const selectors = [
  { label: "Due date", option: "Today", clearLabel: "Clear due date", placeholder: "No date" },
  { label: "Category", option: "Work", clearLabel: "Clear category", placeholder: "None" },
] as const

function renderPanel() {
  return render(
    <CreateTodoPanel
      isOpen
      onToggle={vi.fn()}
      categories={categories}
      onSubmit={vi.fn().mockResolvedValue(undefined)}
      onCreateCategory={vi.fn().mockResolvedValue(undefined)}
      onDeleteCategory={vi.fn().mockResolvedValue(undefined)}
    />,
  )
}

function getTrigger(label: string) {
  return screen.getByRole("button", { name: label })
}

function expectChevron(label: string) {
  expect(getTrigger(label).querySelector("[data-selector-chevron]")).toBeInTheDocument()
}

function expectPersistentChevrons() {
  expectChevron("Priority")
  expectChevron("Private task")
}

async function selectValue(user: ReturnType<typeof userEvent.setup>, selector: typeof selectors[number]) {
  await user.click(getTrigger(selector.label))
  const picker = await screen.findByRole("dialog")
  await user.click(within(picker).getByRole("button", { name: selector.option }))
  await waitFor(() => {
    expect(getTrigger(selector.label)).toHaveAttribute("aria-expanded", "false")
    // The outgoing placeholder can remain during the value crossfade; clear tracks selection.
    expect(screen.getByRole("button", { name: selector.clearLabel })).toBeInTheDocument()
    expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440)
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(900)
  // jsdom has no layout; the real portal picker needs the selector's browser rect.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 459,
    right: 710,
    top: 416,
    bottom: 482,
    width: 251,
    height: 66,
    x: 459,
    y: 416,
    toJSON: () => ({}),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("CreateTodoPanel selector clear controls", () => {
  it("shows chevrons without clear controls when date and category are unset", () => {
    renderPanel()

    for (const selector of selectors) {
      expect(getTrigger(selector.label)).toHaveTextContent(selector.placeholder)
      expect(getTrigger(selector.label)).toHaveAttribute("aria-expanded", "false")
      expectChevron(selector.label)
      expect(screen.queryByRole("button", { name: selector.clearLabel })).not.toBeInTheDocument()
    }
    expectPersistentChevrons()
  })

  it.each(selectors)("replaces the $label chevron with clear after selecting $option", async selector => {
    const user = userEvent.setup()
    renderPanel()

    await selectValue(user, selector)

    expect(screen.getByRole("button", { name: selector.clearLabel })).toBeInTheDocument()
    expect(getTrigger(selector.label).querySelector("[data-selector-chevron]")).not.toBeInTheDocument()
    expectPersistentChevrons()
  })

  it.each(selectors)("clears $label and restores its chevron without reopening the picker", async selector => {
    const user = userEvent.setup()
    renderPanel()
    await selectValue(user, selector)

    await user.click(screen.getByRole("button", { name: selector.clearLabel }))

    await waitFor(() => {
      expect(getTrigger(selector.label)).toHaveTextContent(selector.placeholder)
      expect(getTrigger(selector.label)).toHaveAttribute("aria-expanded", "false")
      expect(screen.queryByRole("button", { name: selector.clearLabel })).not.toBeInTheDocument()
      expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: selector.option, hidden: true })).not.toBeInTheDocument()
    })
    expectChevron(selector.label)
    expectPersistentChevrons()
  })

  it.each(selectors.flatMap(selector => [
    { ...selector, key: "{Enter}", keyName: "Enter" },
    { ...selector, key: " ", keyName: "Space" },
  ]))("clears $label with $keyName using an independent native button", async selector => {
    const user = userEvent.setup()
    const { container } = renderPanel()
    await selectValue(user, selector)

    const clear = screen.getByRole("button", { name: selector.clearLabel })
    expect(clear.tagName).toBe("BUTTON")
    expect(clear).toHaveAttribute("type", "button")
    expect(getTrigger(selector.label)).not.toContainElement(clear)
    expect(container.querySelector("button button, button [role='button']")).toBeNull()

    clear.focus()
    expect(clear).toHaveFocus()
    await user.keyboard(selector.key)

    await waitFor(() => {
      expect(getTrigger(selector.label)).toHaveTextContent(selector.placeholder)
      expect(getTrigger(selector.label)).toHaveAttribute("aria-expanded", "false")
      expect(screen.queryByRole("button", { name: selector.clearLabel })).not.toBeInTheDocument()
      expect(screen.queryByRole("dialog", { hidden: true })).not.toBeInTheDocument()
    })
    expectChevron(selector.label)
    expectPersistentChevrons()
  })
})

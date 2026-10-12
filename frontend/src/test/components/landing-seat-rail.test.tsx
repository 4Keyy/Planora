import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SeatRail } from '@/app/_landing/seat-rail'
import { FIXTURE_FRIENDS } from '@/app/_landing/fixtures'

const reduced = vi.hoisted(() => ({ value: false }))
vi.mock('framer-motion', async importOriginal => ({
  ...await importOriginal<typeof import('framer-motion')>(),
  useReducedMotion: () => reduced.value,
}))

class RailPointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  constructor(type: string, options: PointerEventInit) {
    super(type, options)
    this.pointerId = options.pointerId ?? 1
    this.pointerType = options.pointerType ?? 'mouse'
  }
}

function Control() {
  const [value, setValue] = useState(0)
  return <SeatRail value={value} onChange={setValue} friends={FIXTURE_FRIENDS} labelledBy="people" />
}

function pointer(rail: HTMLElement, type: string, x: number, y = 0, pointerType = 'touch') {
  fireEvent(rail, new RailPointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerType }))
}

beforeEach(() => {
  reduced.value = true
})
afterEach(() => vi.restoreAllMocks())

describe('seat rail input and initial geometry', () => {
  it('renders the same seat without layout reads on the server and initial client', () => {
    const props = { value: 3, onChange: vi.fn(), friends: FIXTURE_FRIENDS, labelledBy: 'people' }
    const measure = vi.spyOn(Element.prototype, 'getBoundingClientRect')
    // jsdom has a window during server rendering, so dependencies choose layout effects.
    const warnings = vi.spyOn(console, 'error').mockImplementation(() => {})
    const markup = renderToString(<SeatRail {...props} />)
    expect(warnings.mock.calls.every(([message]) => String(message).includes('useLayoutEffect does nothing on the server'))).toBe(true)
    warnings.mockRestore()
    const { container } = render(<SeatRail {...props} />)
    expect(measure).not.toHaveBeenCalled()
    const server = document.createElement('div')
    server.innerHTML = markup
    const serverRail = server.querySelector('[role="slider"]')!
    const clientRail = container.querySelector('[role="slider"]')!
    expect((serverRail.lastElementChild as HTMLElement).style.cssText).toBe((clientRail.lastElementChild as HTMLElement).style.cssText)
    expect((serverRail.children[2] as HTMLElement).style.cssText).toBe((clientRail.children[2] as HTMLElement).style.cssText)
  })

  it('preserves every slider key and clamps repeated arrows', () => {
    render(<Control />)
    const rail = screen.getByRole('slider')
    for (const [key, value] of [['End', 10], ['ArrowUp', 10], ['PageDown', 7], ['ArrowLeft', 6], ['Home', 0], ['ArrowDown', 0], ['PageUp', 3], ['ArrowRight', 4]] as const) {
      fireEvent.keyDown(rail, { key, repeat: true })
      expect(rail).toHaveAttribute('aria-valuenow', String(value))
    }
  })

  it('waits for horizontal touch intent, keeps vertical scrolling and handles cancellation', () => {
    render(<Control />)
    const rail = screen.getByRole('slider')
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 110 } as DOMRect)
    expect(rail.className).toContain('touch-pan-y')
    pointer(rail, 'pointerdown', 5)
    pointer(rail, 'pointermove', 10, 0)
    expect(rail).toHaveAttribute('aria-valuenow', '0')
    pointer(rail, 'pointermove', 20, 40)
    expect(rail).toHaveAttribute('aria-valuenow', '0')
    pointer(rail, 'pointercancel', 20, 40)
    pointer(rail, 'pointermove', 80)
    expect(rail).toHaveAttribute('aria-valuenow', '0')
    pointer(rail, 'pointerdown', 5)
    pointer(rail, 'pointermove', 95)
    expect(rail).toHaveAttribute('aria-valuenow', '9')
    expect(rail.className).toContain('cursor-grabbing')
    pointer(rail, 'pointermove', 200)
    pointer(rail, 'pointerup', 200)
    expect(rail).toHaveAttribute('aria-valuenow', '10')
    expect(rail.className).toContain('cursor-pointer')
  })

  it('selects a touch tap and instantly positions both visuals under reduced motion', async () => {
    render(<Control />)
    const rail = screen.getByRole('slider')
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 110 } as DOMRect)
    pointer(rail, 'pointerdown', 55)
    expect(rail).toHaveAttribute('aria-valuenow', '0')
    pointer(rail, 'pointerup', 55)
    expect(rail).toHaveAttribute('aria-valuenow', '5')
    await waitFor(() => expect(rail.lastElementChild).toHaveStyle({ transform: 'translateX(500%)' }))
    await waitFor(() => expect(rail.children[2]).toHaveStyle({ transform: 'scaleX(0.5)' }))
  })
})

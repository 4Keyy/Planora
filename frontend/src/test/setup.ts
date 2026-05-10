import '@testing-library/jest-dom'
import { vi } from 'vitest'

Element.prototype.hasPointerCapture ??= vi.fn(() => false)
Element.prototype.setPointerCapture ??= vi.fn()
Element.prototype.releasePointerCapture ??= vi.fn()
HTMLElement.prototype.scrollIntoView ??= vi.fn()
Object.defineProperty(window, 'scrollTo', { value: () => undefined, writable: true })

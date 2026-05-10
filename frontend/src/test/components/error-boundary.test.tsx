import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { ErrorBoundary } from '@/components/error-boundary'

// Silence the expected console.error output from ErrorBoundary.componentDidCatch
// and React's own error boundary logging during these tests.
const preventExpectedWindowError = (event: ErrorEvent) => {
  if (event.error instanceof Error && event.error.message === 'Test explosion') {
    event.preventDefault()
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  window.addEventListener('error', preventExpectedWindowError)
})

afterEach(() => {
  window.removeEventListener('error', preventExpectedWindowError)
  vi.restoreAllMocks()
})

// A child component that unconditionally throws
function BrokenChild(): React.ReactElement {
  throw new Error('Test explosion')
}

describe('<ErrorBoundary />', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <span>All good</span>
      </ErrorBoundary>
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('renders the default fallback UI when a child throws', () => {
    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
  })

  it('runs the default reload action from the fallback UI', () => {
    render(
      <ErrorBoundary>
        <BrokenChild />
      </ErrorBoundary>
    )

    fireEvent.click(screen.getByRole('button', { name: /reload page/i }))

    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
  })

  it('renders a custom fallback when provided and a child throws', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <BrokenChild />
      </ErrorBoundary>
    )
    expect(screen.getByText('Custom error UI')).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument()
  })
})

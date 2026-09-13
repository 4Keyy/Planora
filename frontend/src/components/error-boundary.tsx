'use client'

import { Component, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log to console in development; in production wire to your error tracker
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="flex min-h-screen items-center justify-center bg-paper-sunken px-4">
          <div className="max-w-md w-full rounded-xl border border-line bg-paper p-8 shadow-lg text-center space-y-4">
            <div className="text-display-sm">⚠️</div>
            <h2 className="text-title-sm font-bold text-ink">Something went wrong</h2>
            <p className="text-body-sm text-ink-subtle">
              An unexpected error occurred. Please refresh the page.
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null })
                window.location.reload()
              }}
              className="mt-2 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-body-sm font-semibold text-paper hover:bg-gray-700 transition-colors"
            >
              Reload page
            </button>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <pre className="mt-4 text-left text-caption text-alert bg-alert-surface rounded-lg p-4 overflow-auto max-h-40">
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

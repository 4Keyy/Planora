import { describe, it, expect, afterEach, vi } from "vitest"
import { NextRequest } from "next/server"
import { middleware } from "@/middleware"

function cspFor(path: string): string {
  const res = middleware(new NextRequest(`http://localhost:3000${path}`))
  const csp = res.headers.get("content-security-policy")
  expect(csp).toBeTruthy()
  return csp as string
}

describe("CSP middleware", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("sets a nonce-based script-src with no 'unsafe-inline'", () => {
    const csp = cspFor("/dashboard")
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/)
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  })

  it("locks down framing, base-uri and form-action", () => {
    const csp = cspFor("/")
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
  })

  it("issues a unique nonce on every request", () => {
    const first = cspFor("/").match(/'nonce-([^']+)'/)?.[1]
    const second = cspFor("/").match(/'nonce-([^']+)'/)?.[1]
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()
    expect(first).not.toEqual(second)
  })

  it("allows 'unsafe-eval' only in development", () => {
    vi.stubEnv("NODE_ENV", "development")
    const devCsp = cspFor("/")
    expect(devCsp).toMatch(/script-src[^;]*'unsafe-eval'/)
    // Dev connect-src is relaxed to any http/https/ws so a page served from a LAN IP can reach
    // the gateway on the same host (the exact LAN IP is not known ahead of time).
    expect(devCsp).toMatch(/connect-src[^;]*http:[^;]*ws:/)

    vi.stubEnv("NODE_ENV", "production")
    const prodCsp = cspFor("/")
    expect(prodCsp).not.toMatch(/script-src[^;]*'unsafe-eval'/)
    // Production connect-src does not get the blanket `http:`/`ws:` dev allowance.
    expect(prodCsp).not.toMatch(/connect-src[^;]*\bws:/)
  })

  it("adds upgrade-insecure-requests for an https API origin in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.planora.example")
    const csp = cspFor("/")
    expect(csp).toContain("upgrade-insecure-requests")
    expect(csp).toContain("connect-src 'self' https://api.planora.example")
  })

  it("falls back to the local gateway when the API origin is invalid", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "not-a-valid-url")
    vi.stubEnv("NEXT_PUBLIC_API_GATEWAY_URL", "")
    const csp = cspFor("/")
    expect(csp).toContain("http://localhost:5132")
    expect(csp).not.toContain("upgrade-insecure-requests")
  })

  it("falls back to the local gateway for a non-http(s) API origin", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "ftp://files.example.com")
    const csp = cspFor("/")
    expect(csp).toContain("http://localhost:5132")
  })

  it("uses NEXT_PUBLIC_API_GATEWAY_URL when NEXT_PUBLIC_API_URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "")
    vi.stubEnv("NEXT_PUBLIC_API_GATEWAY_URL", "https://gateway.planora.example")
    const csp = cspFor("/")
    expect(csp).toContain("connect-src 'self' https://gateway.planora.example")
  })

  it("uses the default gateway when no API origin env var is set", () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "")
    vi.stubEnv("NEXT_PUBLIC_API_GATEWAY_URL", "")
    const csp = cspFor("/")
    expect(csp).toContain("connect-src 'self' http://localhost:5132")
  })

  it("returns the Content-Security-Policy header on the response", () => {
    const res = middleware(new NextRequest("http://localhost:3000/tasks"))
    expect(res.headers.get("content-security-policy")).toContain("script-src")
  })
})

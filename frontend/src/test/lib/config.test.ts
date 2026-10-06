import { afterEach, describe, expect, it, vi } from "vitest"

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL
const originalGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL
const originalSameOrigin = process.env.NEXT_PUBLIC_API_SAME_ORIGIN

async function loadConfig(apiUrl?: string, gatewayUrl?: string, sameOrigin?: string) {
  vi.resetModules()
  if (apiUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_URL
  } else {
    process.env.NEXT_PUBLIC_API_URL = apiUrl
  }

  if (gatewayUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_GATEWAY_URL
  } else {
    process.env.NEXT_PUBLIC_API_GATEWAY_URL = gatewayUrl
  }

  if (sameOrigin === undefined) {
    delete process.env.NEXT_PUBLIC_API_SAME_ORIGIN
  } else {
    process.env.NEXT_PUBLIC_API_SAME_ORIGIN = sameOrigin
  }

  return import("@/lib/config")
}

describe("config", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    if (originalApiUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalApiUrl
    }
    if (originalGatewayUrl === undefined) {
      delete process.env.NEXT_PUBLIC_API_GATEWAY_URL
    } else {
      process.env.NEXT_PUBLIC_API_GATEWAY_URL = originalGatewayUrl
    }
    if (originalSameOrigin === undefined) {
      delete process.env.NEXT_PUBLIC_API_SAME_ORIGIN
    } else {
      process.env.NEXT_PUBLIC_API_SAME_ORIGIN = originalSameOrigin
    }
  })

  it("uses a normalized NEXT_PUBLIC_API_URL origin when configured", async () => {
    const { getApiBaseUrl } = await loadConfig("https://api.example.com/")

    expect(getApiBaseUrl()).toBe("https://api.example.com")
  })

  it("falls back to NEXT_PUBLIC_API_GATEWAY_URL when API URL is absent", async () => {
    const { getApiBaseUrl } = await loadConfig(undefined, "http://gateway.local:8080")

    expect(getApiBaseUrl()).toBe("http://gateway.local:8080")
  })

  it("keeps local browser and local API hosts aligned for CSRF cookies", async () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        hostname: "localhost",
      },
    })

    const { getApiBaseUrl } = await loadConfig("http://192.168.42.15:5132")

    expect(getApiBaseUrl()).toBe("http://localhost:5132")
  })

  it("derives the LAN API URL when a LAN browser opens a localhost-configured bundle", async () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        hostname: "192.168.42.15",
      },
    })

    const { getApiBaseUrl } = await loadConfig("http://localhost:5132")

    expect(getApiBaseUrl()).toBe("http://192.168.42.15:5132")
  })

  it("routes API through the frontend origin when a tunnel host opens a localhost-configured bundle", async () => {
    // Phone / tunnel: the page is reached at a public host that can't see the gateway's
    // own :5132, but the API is still pinned to localhost. The base URL becomes the
    // frontend's own origin so the Next rewrites proxy it through the single exposed port.
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "abc123.trycloudflare.com",
        origin: "https://abc123.trycloudflare.com",
      },
    })

    const { getApiBaseUrl } = await loadConfig("http://localhost:5132")

    expect(getApiBaseUrl()).toBe("https://abc123.trycloudflare.com")
  })

  it("does not hijack a production public API host for the frontend origin", async () => {
    // Browser on a public host AND API configured on a different public host (prod): keep
    // calling the configured API directly — the tunnel rewrite must not steal this case.
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "app.planora.com",
        origin: "https://app.planora.com",
      },
    })

    const { getApiBaseUrl } = await loadConfig("https://api.planora.com")

    expect(getApiBaseUrl()).toBe("https://api.planora.com")
  })

  it("rejects configured URLs with paths, queries, hashes, bad protocols, or invalid syntax", async () => {
    for (const value of [
      "https://api.example.com/v1",
      "https://api.example.com?x=1",
      "https://api.example.com/#hash",
      "ftp://api.example.com",
      "not a url",
    ]) {
      const { getApiBaseUrl } = await loadConfig(value)

      expect(getApiBaseUrl()).toBe(`${window.location.protocol}//${window.location.hostname}:5132`)
    }
  })

  it("derives the browser-local API URL when no valid env value exists", async () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "planora.local",
      },
    })

    const { getApiBaseUrl } = await loadConfig()

    expect(getApiBaseUrl()).toBe("https://planora.local:5132")
  })

  it("routes every browser call through the frontend origin when NEXT_PUBLIC_API_SAME_ORIGIN=1", async () => {
    // Escape hatch for a local run where the browser reaches :3000 but stalls on the
    // gateway's :5132. The flag wins over every other rule, including the configured host.
    vi.stubGlobal("window", {
      location: {
        protocol: "http:",
        hostname: "localhost",
        origin: "http://localhost:3000",
      },
    })

    const { getApiBaseUrl } = await loadConfig("http://192.168.42.19:5132", undefined, "1")

    expect(getApiBaseUrl()).toBe("http://localhost:3000")
  })

  it("leaves the configured API host alone when NEXT_PUBLIC_API_SAME_ORIGIN is not exactly 1", async () => {
    vi.stubGlobal("window", {
      location: {
        protocol: "https:",
        hostname: "app.planora.com",
        origin: "https://app.planora.com",
      },
    })

    const { getApiBaseUrl } = await loadConfig("https://api.planora.com", undefined, "0")

    expect(getApiBaseUrl()).toBe("https://api.planora.com")
  })

  it("keeps SSR calling the gateway directly even with same-origin routing on", async () => {
    // There is no window on the server, so the rewrites can't apply — the Next server must
    // reach the gateway by its configured origin.
    vi.stubGlobal("window", undefined)

    const { getApiBaseUrl } = await loadConfig("http://localhost:5132", undefined, "1")

    expect(getApiBaseUrl()).toBe("http://localhost:5132")
  })

  it("uses localhost when running without a browser window", async () => {
    vi.stubGlobal("window", undefined)

    const { getApiBaseUrl } = await loadConfig()

    expect(getApiBaseUrl()).toBe("http://localhost:5132")
  })
})

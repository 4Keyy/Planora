import { afterEach, describe, expect, it, vi } from "vitest"

const originalApiUrl = process.env.NEXT_PUBLIC_API_URL
const originalGatewayUrl = process.env.NEXT_PUBLIC_API_GATEWAY_URL

async function loadConfig(apiUrl?: string, gatewayUrl?: string) {
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

  it("uses localhost when running without a browser window", async () => {
    vi.stubGlobal("window", undefined)

    const { getApiBaseUrl } = await loadConfig()

    expect(getApiBaseUrl()).toBe("http://localhost:5132")
  })
})

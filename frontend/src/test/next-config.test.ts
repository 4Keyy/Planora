import { createRequire } from "node:module"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const requireConfig = createRequire(import.meta.url)
const configPath = path.resolve(process.cwd(), "next.config.js")

type Rewrite = { source: string; destination: string }
type Config = {
  env: Record<string, string>
  images: { unoptimized: boolean; remotePatterns: unknown[] }
  rewrites: () => Promise<Rewrite[]>
}

function loadConfig() {
  delete requireConfig.cache[configPath]
  return requireConfig(configPath) as Config
}

async function gatewayRewrites(config: Config) {
  return (await config.rewrites()).filter(({ source }) => source !== "/favicon.ico")
}

describe("Next server API upstream", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("NEXT_PUBLIC_API_URL", "")
    vi.stubEnv("NEXT_PUBLIC_API_GATEWAY_URL", "")
    vi.stubEnv("API_GATEWAY_INTERNAL_URL", "")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    delete requireConfig.cache[configPath]
  })

  it("preserves the localhost default when no API origins are configured", async () => {
    const config = loadConfig()
    const rewrites = await gatewayRewrites(config)

    expect(config.env).toEqual({ NEXT_PUBLIC_API_URL: "http://localhost:5132" })
    expect(rewrites).toHaveLength(9)
    for (const { source, destination } of rewrites) {
      expect(destination).toBe(`http://localhost:5132${source}`)
    }
  })

  it("defaults the upstream to the normalized public API origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.planora.example/")
    const config = loadConfig()

    expect(config.env.NEXT_PUBLIC_API_URL).toBe("https://api.planora.example")
    for (const { source, destination } of await gatewayRewrites(config)) {
      expect(destination).toBe(`https://api.planora.example${source}`)
    }
  })

  it.each([
    ["http://api-gateway:80", "http://api-gateway"],
    ["http://gateway:8080/", "http://gateway:8080"],
    ["https://gateway.internal:8443/", "https://gateway.internal:8443"],
  ])("uses %s only for server rewrites", async (internalUrl, normalizedUrl) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://app.planora.example")
    vi.stubEnv("API_GATEWAY_INTERNAL_URL", internalUrl)
    const config = loadConfig()

    for (const { source, destination } of await gatewayRewrites(config)) {
      expect(destination).toBe(`${normalizedUrl}${source}`)
    }
    expect(config.env).toEqual({ NEXT_PUBLIC_API_URL: "https://app.planora.example" })
    expect(JSON.stringify(config.env)).not.toContain("gateway")
    expect(config.images.unoptimized).toBe(false)
    expect(config.images.remotePatterns).toEqual([
      { protocol: "https", hostname: "app.planora.example" },
    ])
  })

  it.each([
    "not a url",
    "ftp://gateway:8080",
    "//gateway:8080",
    "http://gateway:8080/api",
    "http://gateway:8080?route=api",
    "http://gateway:8080/#route",
    "http://user:password@gateway:8080",
  ])("falls back to the public origin for an invalid internal origin: %s", async (internalUrl) => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.planora.example")
    vi.stubEnv("API_GATEWAY_INTERNAL_URL", internalUrl)
    const config = loadConfig()

    for (const { source, destination } of await gatewayRewrites(config)) {
      expect(destination).toBe(`https://api.planora.example${source}`)
    }
    expect(config.env).toEqual({ NEXT_PUBLIC_API_URL: "https://api.planora.example" })
  })
})

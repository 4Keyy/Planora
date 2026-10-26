import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// Every path the client calls must have a route through the API gateway, in both gateway
// configurations: a call without one answers 404 at the gateway and works nowhere but in tests,
// which mock the network. `GET /auth/api/v1/users` (the admin user list) had none — only
// `/auth/api/v1/users/{everything}`, which needs a segment after `users` (FE-11, API-12).

const frontend = process.cwd()
const repoRoot = path.resolve(frontend, "..")

type Route = { UpstreamPathTemplate: string; UpstreamHttpMethod?: string[] }

function routes(file: string): { template: string; pattern: RegExp; methods: string[] }[] {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, "Planora.ApiGateway", file), "utf8")) as { Routes: Route[] }
  return config.Routes.map((route) => ({
    template: route.UpstreamPathTemplate,
    // `{everything}` takes one or more segments; any other placeholder takes exactly one.
    pattern: new RegExp(`^${route.UpstreamPathTemplate
      .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
      .replace(/\{everything\}/g, "\u0000")
      .replace(/\{[^}]+\}/g, "[^/]+")
      .replace(/\u0000/g, ".+")}$`),
    methods: (route.UpstreamHttpMethod ?? []).map((method) => method.toUpperCase()),
  }))
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "test" ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}

/** `METHOD /path` for every call through the shared client, and `ANY /path` for direct fetches. */
function clientCalls(): string[] {
  const calls = new Set<string>()
  const placeholder = (raw: string) => raw.replace(/\$\{[^}]+\}/g, "x").split(/[?#]/)[0]
  for (const file of sourceFiles(path.join(frontend, "src"))) {
    const text = fs.readFileSync(file, "utf8")
    for (const match of text.matchAll(/\bapi\.(get|post|put|patch|delete)\s*(?:<[^()]*?>)?\(\s*(["`])(\/[^"`]*)\2/g)) {
      calls.add(`${match[1].toUpperCase()} ${placeholder(match[3])}`)
    }
    for (const match of text.matchAll(/\$\{getApiBaseUrl\(\)\}(\/[\w/.{}$-]+)/g)) {
      calls.add(`ANY ${placeholder(match[1])}`)
    }
  }
  return [...calls].sort()
}

describe("every client call has a gateway route", () => {
  const calls = clientCalls()

  it("finds the client's calls", () => {
    expect(calls.length).toBeGreaterThan(40)
    expect(calls).toContain("GET /auth/api/v1/users")
    expect(calls).toContain("ANY /realtime/hubs/notifications")
  })

  it.each(["ocelot.json", "ocelot.Docker.json"])("%s routes them all", (file) => {
    const table = routes(file)
    const unrouted = calls.filter((call) => {
      const [method, url] = call.split(" ")
      return !table.some((route) => route.pattern.test(url) && (method === "ANY" || route.methods.length === 0 || route.methods.includes(method)))
    })
    expect(unrouted).toEqual([])
  })
})

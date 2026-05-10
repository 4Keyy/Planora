const DEFAULT_API_BASE_URL = "http://localhost:5132"
const configuredApiBaseUrl =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_API_GATEWAY_URL

function isLocalNetworkHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true
  }

  const parts = hostname.split(".").map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false
  }

  const [first, second] = parts
  return first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
}

function normalizeApiBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (url.pathname !== "/" || url.search || url.hash) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

function getBrowserSameHostApiBaseUrl(configured: string | undefined): string | undefined {
  if (typeof window === "undefined") return undefined

  const browserHost = window.location.hostname
  if (!isLocalNetworkHost(browserHost)) return undefined

  if (!configured) {
    return `${window.location.protocol}//${browserHost}:5132`
  }

  const configuredUrl = new URL(configured)
  if (!isLocalNetworkHost(configuredUrl.hostname)) return undefined
  if (configuredUrl.hostname === browserHost) return undefined

  return `${configuredUrl.protocol}//${browserHost}:5132`
}

export function getApiBaseUrl(): string {
  const configured = normalizeApiBaseUrl(configuredApiBaseUrl)
  const browserSameHost = getBrowserSameHostApiBaseUrl(configured)
  if (browserSameHost) return browserSameHost
  if (configured) return configured

  if (typeof window !== "undefined") {
    const { hostname, protocol } = window.location
    return `${protocol}//${hostname}:5132`
  }

  return DEFAULT_API_BASE_URL
}

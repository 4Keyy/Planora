export type JwtPayload = {
  exp?: number
  iat?: number
  sub?: string
  email?: string
  firstName?: string
  lastName?: string
  emailVerified?: string | boolean
  role?: string | string[]
  roles?: string[] | string
  [key: string]: unknown
}

const base64UrlDecode = (input: string): string => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=")
  if (typeof atob === "undefined") return ""
  const binaryStr = atob(padded)
  return decodeURIComponent(
    binaryStr.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  )
}

export const decodeJwt = (token: string): JwtPayload | null => {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payload = base64UrlDecode(parts[1])
    if (!payload) return null
    return JSON.parse(payload) as JwtPayload
  } catch {
    return null
  }
}

export const getJwtRoles = (payload: JwtPayload | null): string[] => {
  if (!payload) return []
  const roleClaim =
    (payload.role ?? payload.roles ??
      payload["http://schemas.microsoft.com/ws/2008/06/identity/claims/role"] ??
      payload["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role"]) ?? []
  if (Array.isArray(roleClaim)) return roleClaim.filter(Boolean)
  if (typeof roleClaim === "string") return [roleClaim]
  return []
}

export const getJwtEmailVerified = (payload: JwtPayload | null): boolean | undefined => {
  if (!payload || payload.emailVerified === undefined) return undefined
  if (typeof payload.emailVerified === "boolean") return payload.emailVerified
  if (typeof payload.emailVerified === "string") {
    return payload.emailVerified.toLowerCase() === "true"
  }
  return undefined
}

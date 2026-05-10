import { afterEach, describe, it, expect, vi } from 'vitest'
import { decodeJwt, getJwtEmailVerified, getJwtRoles } from '@/lib/jwt'

// A real HS256 JWT with payload: { sub: "user-123", email: "test@example.com", exp: 9999999999 }
// Header: {"alg":"HS256","typ":"JWT"}
// Payload (base64url): eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImV4cCI6OTk5OTk5OTk5OX0
const VALID_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImV4cCI6OTk5OTk5OTk5OX0.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

describe('decodeJwt()', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('extracts sub, email, and exp from a valid JWT', () => {
    const payload = decodeJwt(VALID_TOKEN)
    expect(payload).not.toBeNull()
    expect(payload?.sub).toBe('user-123')
    expect(payload?.email).toBe('test@example.com')
    expect(payload?.exp).toBe(9999999999)
  })

  it('returns null for a malformed token (no throw)', () => {
    expect(() => decodeJwt('not.a.jwt')).not.toThrow()
    expect(decodeJwt('not.a.jwt')).toBeNull()
  })

  it('returns null when the token has too few segments', () => {
    expect(decodeJwt('onlyone')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(decodeJwt('')).toBeNull()
  })

  it('returns null when browser base64 decoding is unavailable', () => {
    vi.stubGlobal('atob', undefined)

    expect(decodeJwt(VALID_TOKEN)).toBeNull()
  })

  it('normalizes role claims from modern and legacy JWT claim names', () => {
    expect(getJwtRoles(null)).toEqual([])
    expect(getJwtRoles({ role: ['Admin', '', 'User'] })).toEqual(['Admin', 'User'])
    expect(getJwtRoles({ roles: 'Manager' })).toEqual(['Manager'])
    expect(getJwtRoles({ 'http://schemas.microsoft.com/ws/2008/06/identity/claims/role': 'Legacy' })).toEqual(['Legacy'])
    expect(getJwtRoles({ 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/role': ['Soap'] })).toEqual(['Soap'])
    expect(getJwtRoles({ role: 123 as never })).toEqual([])
  })

  it('normalizes email verification claims', () => {
    expect(getJwtEmailVerified(null)).toBeUndefined()
    expect(getJwtEmailVerified({})).toBeUndefined()
    expect(getJwtEmailVerified({ emailVerified: true })).toBe(true)
    expect(getJwtEmailVerified({ emailVerified: 'TRUE' })).toBe(true)
    expect(getJwtEmailVerified({ emailVerified: 'false' })).toBe(false)
    expect(getJwtEmailVerified({ emailVerified: 1 as never })).toBeUndefined()
  })
})

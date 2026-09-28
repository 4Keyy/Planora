import { describe, expect, it } from 'vitest'
import {
  extractErrorMessage,
  getAuthRequestMessage,
  getLinkRequestMessage,
  getLoginErrorMessage,
  getResetErrorKind,
  getVerifyErrorKind,
  getRegisterErrorMessage,
  isServerUnavailableError,
  isTwoFactorChallenge,
} from '@/lib/errors'

describe('auth error messages', () => {
  it('reports invalid login credentials separately from server outages', () => {
    const err = { response: { status: 401, data: { message: 'Invalid credentials' } } }

    expect(getLoginErrorMessage(err)).toBe("That email and password don't match. Check both and try again.")
  })

  it('reports unavailable API during login', () => {
    const err = { request: {}, code: 'ERR_NETWORK', message: 'Network Error' }

    expect(isServerUnavailableError(err)).toBe(true)
    expect(getLoginErrorMessage(err)).toBe(
      "Can't reach Planora. Check your connection and try again.",
    )
  })

  it('reports duplicate account separately during registration', () => {
    const err = { response: { status: 409, data: { message: 'Email already exists' } } }

    expect(getRegisterErrorMessage(err)).toBe('An account with this email already exists. Sign in instead.')
  })

  it('reports unavailable API during registration', () => {
    const err = { request: {}, message: 'Failed to fetch' }

    expect(getRegisterErrorMessage(err)).toBe(
      "Can't reach Planora. Check your connection and try again.",
    )
  })

  it('detects two-factor challenges from API messages', () => {
    const err = { response: { status: 400, data: { message: 'Two-factor code required' } } }

    expect(isTwoFactorChallenge(err)).toBe(true)
  })

  it('extracts safe messages from all supported API envelope shapes', () => {
    expect(extractErrorMessage('plain error')).toBe('plain error')
    expect(extractErrorMessage({ response: { data: { error: 'error field' } } })).toBe('error field')
    expect(extractErrorMessage({ response: { data: { detail: 'detail field' } } })).toBe('detail field')
    expect(extractErrorMessage({ message: 'native message' })).toBe('native message')
    expect(extractErrorMessage({ response: { data: { message: 123 } } }, 'fallback')).toBe('fallback')
    expect(extractErrorMessage(null, 'null fallback')).toBe('null fallback')
    expect(extractErrorMessage({ response: { data: null } }, 'null-data fallback')).toBe('null-data fallback')
  })

  it('does not treat server responses as network outages', () => {
    expect(isServerUnavailableError({ response: { status: 503 }, request: {} })).toBe(false)
    expect(isServerUnavailableError(null)).toBe(false)
  })

  it('detects all network-style outage signals without a response', () => {
    expect(isServerUnavailableError({ code: 'ECONNABORTED' })).toBe(true)
    expect(isServerUnavailableError({ message: 'request timeout' })).toBe(true)
    expect(isServerUnavailableError({ message: 'Failed to fetch' })).toBe(true)
  })

  it('separates a malformed request from wrong credentials', () => {
    // 401 is "those credentials are wrong"; 400 is "that request was malformed", which
    // is not the user's password. Collapsing them sent people off to reset a password
    // that was never the problem, and this test asserted that behaviour.
    expect(getLoginErrorMessage({ response: { status: 401 } })).toBe("That email and password don't match. Check both and try again.")
    expect(getLoginErrorMessage({ response: { status: 400 } })).toBe('Something went wrong on our side. Try again in a moment.')
  })

  it('maps remaining login status families to user-safe messages', () => {
    expect(getLoginErrorMessage({ response: { status: 403 } })).toBe('This account is locked after too many attempts. Try again in 30 minutes.')
    expect(getLoginErrorMessage({ response: { status: 500 } })).toBe('Something went wrong on our side. Try again in a moment.')
    expect(getLoginErrorMessage({ response: { status: 418 } })).toBe("Couldn't sign you in. Try again.")
  })

  it('maps remaining registration status families to user-safe messages', () => {
    expect(getRegisterErrorMessage({ response: { status: 400 } })).toBe('Check your details and try again.')
    expect(getRegisterErrorMessage({ response: { status: 503 } })).toBe('Something went wrong on our side. Try again in a moment.')
    expect(getRegisterErrorMessage({ response: { status: 422 } })).toBe("Couldn't create the account. Try again.")
  })

  it('detects two-factor variants from raw messages', () => {
    expect(isTwoFactorChallenge({ message: '2FA required' })).toBe(true)
    expect(isTwoFactorChallenge({ message: 'two factor challenge' })).toBe(true)
    expect(isTwoFactorChallenge({ message: 'password rejected' })).toBe(false)
  })
})

describe('password reset and verification refusals', () => {
  const withCode = (status: number, code: string) => ({ response: { status, data: { code, message: 'x' } } })

  it('puts a password refusal on the password, not on the link', () => {
    // The old page said "Check the token and try again" for all of these, so a weak or
    // breached new password sent people to inspect a link that was fine.
    expect(getResetErrorKind(withCode(400, 'WEAK_PASSWORD'))).toBe('weak-password')
    expect(getResetErrorKind(withCode(400, 'COMPROMISED_PASSWORD'))).toBe('compromised-password')
    expect(getResetErrorKind(withCode(400, 'INVALID_TOKEN'))).toBe('invalid-token')
    expect(getResetErrorKind({ response: { status: 400, data: { error: { code: 'INVALID_TOKEN' } } } })).toBe('invalid-token')
  })

  it('reads a bare 401 as a dead link and a 429 as a rate limit', () => {
    expect(getResetErrorKind({ response: { status: 401 } })).toBe('invalid-token')
    expect(getResetErrorKind({ response: { status: 429 } })).toBe('rate-limited')
    expect(getResetErrorKind({ request: {}, code: 'ERR_NETWORK' })).toBe('network')
    expect(getResetErrorKind({ response: { status: 500 } })).toBe('unknown')
  })

  it('treats any 400 from the verification link as a link that did not work', () => {
    expect(getVerifyErrorKind({ response: { status: 400 } })).toBe('invalid-token')
    expect(getVerifyErrorKind(withCode(400, 'INVALID_TOKEN'))).toBe('invalid-token')
    expect(getVerifyErrorKind({ response: { status: 401 } })).toBe('invalid-token')
    expect(getVerifyErrorKind({ request: {}, message: 'Failed to fetch' })).toBe('network')
    expect(getVerifyErrorKind({ response: { status: 502 } })).toBe('unknown')
  })

  it('has one sentence per request refusal', () => {
    expect(getAuthRequestMessage('network')).toBe("Can't reach Planora. Check your connection and try again.")
    expect(getAuthRequestMessage('rate-limited')).toBe('Too many requests. Wait a minute and try again.')
    expect(getAuthRequestMessage('unknown')).toBe('Something went wrong on our side. Try again in a moment.')
    expect(getLinkRequestMessage({ response: { status: 429 } })).toBe('Too many requests. Wait a minute and try again.')
    expect(getLinkRequestMessage({ request: {}, code: 'ERR_NETWORK' })).toBe("Can't reach Planora. Check your connection and try again.")
    expect(getLinkRequestMessage({ response: { status: 500 } })).toBe('Something went wrong on our side. Try again in a moment.')
  })

  it('maps the remaining sign-in and registration refusals', () => {
    expect(getLoginErrorMessage({ response: { status: 429 } })).toBe('Too many attempts. Wait a minute and try again.')
    expect(getRegisterErrorMessage({ response: { status: 429 } })).toBe('Too many attempts. Wait a minute and try again.')
  })
})

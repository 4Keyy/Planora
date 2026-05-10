import { describe, expect, it } from 'vitest'
import {
  extractErrorMessage,
  getLoginErrorMessage,
  getRegisterErrorMessage,
  isServerUnavailableError,
  isTwoFactorChallenge,
} from '@/lib/errors'

describe('auth error messages', () => {
  it('reports invalid login credentials separately from server outages', () => {
    const err = { response: { status: 401, data: { message: 'Invalid credentials' } } }

    expect(getLoginErrorMessage(err)).toBe('Incorrect email or password.')
  })

  it('reports unavailable API during login', () => {
    const err = { request: {}, code: 'ERR_NETWORK', message: 'Network Error' }

    expect(isServerUnavailableError(err)).toBe(true)
    expect(getLoginErrorMessage(err)).toBe(
      'Cannot reach the server. Check that the API is running and try again.',
    )
  })

  it('reports duplicate account separately during registration', () => {
    const err = { response: { status: 409, data: { message: 'Email already exists' } } }

    expect(getRegisterErrorMessage(err)).toBe('An account with this email already exists.')
  })

  it('reports unavailable API during registration', () => {
    const err = { request: {}, message: 'Failed to fetch' }

    expect(getRegisterErrorMessage(err)).toBe(
      'Cannot reach the server. Check that the API is running and try again.',
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

  it('maps remaining login status families to user-safe messages', () => {
    expect(getLoginErrorMessage({ response: { status: 400 } })).toBe('Incorrect email or password.')
    expect(getLoginErrorMessage({ response: { status: 403 } })).toBe('Account is locked. Please contact support.')
    expect(getLoginErrorMessage({ response: { status: 500 } })).toBe('Server error. Please try again later.')
    expect(getLoginErrorMessage({ response: { status: 418 } })).toBe('Unable to sign in. Please try again.')
  })

  it('maps remaining registration status families to user-safe messages', () => {
    expect(getRegisterErrorMessage({ response: { status: 400 } })).toBe('Invalid information. Please check your details.')
    expect(getRegisterErrorMessage({ response: { status: 503 } })).toBe('Server error. Please try again later.')
    expect(getRegisterErrorMessage({ response: { status: 422 } })).toBe('Unable to create account. Please try again.')
  })

  it('detects two-factor variants from raw messages', () => {
    expect(isTwoFactorChallenge({ message: '2FA required' })).toBe(true)
    expect(isTwoFactorChallenge({ message: 'two factor challenge' })).toBe(true)
    expect(isTwoFactorChallenge({ message: 'password rejected' })).toBe(false)
  })
})

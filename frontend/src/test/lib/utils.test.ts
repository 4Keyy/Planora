import { describe, it, expect } from 'vitest'
import { cn, formatDate, formatPublicName, isPastDate, truncateText } from '@/lib/utils'

describe('isPastDate()', () => {
  it('returns true for a date in the past', () => {
    expect(isPastDate('2000-01-01')).toBe(true)
  })

  it('returns false for a date in the future', () => {
    // Use a year well beyond the current date to keep this test stable
    expect(isPastDate('2099-12-31')).toBe(false)
  })

  it('does NOT mutate the input Date object (regression: April audit fix)', () => {
    const input = new Date('2000-06-15T14:30:00.000Z')
    const originalTime = input.getTime()
    isPastDate(input)
    // The function must not change the original Date instance
    expect(input.getTime()).toBe(originalTime)
  })
})

describe('cn()', () => {
  it('merges class names correctly', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  it('deduplicates conflicting Tailwind classes (last one wins)', () => {
    // tailwind-merge should keep only the last conflicting utility
    const result = cn('p-2', 'p-4')
    expect(result).toBe('p-4')
  })

  it('handles conditional falsy values gracefully', () => {
    expect(cn('base', false && 'hidden', undefined, 'extra')).toBe('base extra')
  })
})

describe('formatting helpers', () => {
  it('formats short and long dates using the expected user-facing shapes', () => {
    expect(formatDate('2026-05-03T12:00:00.000Z', 'short')).toMatch(/May\s+3/)
    expect(formatDate(new Date('2026-05-03T12:00:00.000Z'), 'long')).toMatch(/Sun,\s+May\s+3/)
  })

  it('truncates only when text exceeds the configured limit', () => {
    expect(truncateText('short', 10)).toBe('short')
    expect(truncateText('abcdefghijkl', 5)).toBe('abcde...')
  })

  it('formats public author names without leaking full surnames unnecessarily', () => {
    expect(formatPublicName(null)).toBe('Unknown')
    expect(formatPublicName('Prince')).toBe('Prince')
    expect(formatPublicName('Ada Lovelace Byron')).toBe('Ada L.')
  })
})

import { describe, expect, it } from 'vitest'
import { formatTitle, parseTitle } from './title'

describe('parseTitle', () => {
  it('reads the priority prefix', () => {
    expect(parseTitle('! Renew passport')).toEqual({ title: 'Renew passport', priority: 1 })
  })

  it('accepts the prefix without a space, as typed in Google Tasks', () => {
    expect(parseTitle('!Renew passport')).toEqual({ title: 'Renew passport', priority: 1 })
  })

  it('leaves ordinary titles alone', () => {
    expect(parseTitle('Renew passport')).toEqual({ title: 'Renew passport', priority: 0 })
  })

  it('does not treat a mid-title bang as priority', () => {
    expect(parseTitle('Do it! Now')).toEqual({ title: 'Do it! Now', priority: 0 })
  })

  it('eats a leading bang that was meant literally', () => {
    // Accepted cost of the convention — documented in the README, not a bug.
    expect(parseTitle('!important.txt')).toEqual({ title: 'important.txt', priority: 1 })
  })
})

describe('formatTitle', () => {
  it('normalises the prefix on write', () => {
    expect(formatTitle('Renew passport', 1)).toBe('! Renew passport')
    expect(formatTitle('Renew passport', 0)).toBe('Renew passport')
  })

  it('round-trips', () => {
    for (const raw of ['! Renew passport', 'Renew passport']) {
      const { title, priority } = parseTitle(raw)
      expect(formatTitle(title, priority)).toBe(raw)
    }
  })

  it('does not double up the prefix', () => {
    const { title, priority } = parseTitle('! Renew passport')
    expect(formatTitle(title, priority)).toBe('! Renew passport')
  })
})

import { describe, expect, it } from 'vitest'

import { describePage, pageContextFor } from './page-context'

describe('pageContextFor', () => {
  it('maps each product page', () => {
    expect(pageContextFor('/app/').page).toBe('fleet')
    expect(pageContextFor('/app/robots/unitree_g1')).toEqual({ page: 'control', path: '/app/robots/unitree_g1', robotId: 'unitree_g1' })
    expect(pageContextFor('/auth/sign-in').page).toBe('auth')
    expect(pageContextFor('/pricing').page).toBe('other')
  })

  it('decodes the robot id and keeps a malformed one raw', () => {
    expect(pageContextFor('/app/robots/a%20b').robotId).toBe('a b')
    expect(pageContextFor('/app/robots/%E0%A4%A').robotId).toBe('%E0%A4%A')
  })

  it('does not treat deeper or look-alike paths as pages', () => {
    expect(pageContextFor('/app/robots/x/extra').page).toBe('other')
    expect(pageContextFor('/authors').page).toBe('other')
  })
})

describe('describePage', () => {
  it('names the open robot on the Control page', () => {
    expect(describePage({ page: 'control', path: '/app/robots/franka_fr3', robotId: 'franka_fr3' })).toBe(
      'The user is currently on the Control page of robot franka_fr3 (/app/robots/franka_fr3).',
    )
  })

  it('ignores unknown pages and oversized values from the client', () => {
    expect(describePage({ page: 'admin', path: '/admin' })).toBe("The user's current page is unknown.")
    expect(describePage({ page: 'fleet', path: 'x'.repeat(201) })).toBe("The user's current page is unknown.")
    expect(describePage(undefined)).toBe("The user's current page is unknown.")
  })
})

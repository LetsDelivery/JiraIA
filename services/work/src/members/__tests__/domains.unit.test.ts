import { describe, expect, it } from 'bun:test'

import { domainList, domainOf, isAllowedAddress } from '../domains.js'

const LETS = ['uselets.com', 'lets.delivery']

describe('the allowed domains', () => {
  it('admits an address of either domain, whatever its case', () => {
    expect(isAllowedAddress('ana@uselets.com', LETS)).toBe(true)
    expect(isAllowedAddress('Gil@Lets.Delivery', LETS)).toBe(true)
  })

  it('refuses another domain, and one that only ends like ours', () => {
    expect(isAllowedAddress('ana@gmail.com', LETS)).toBe(false)
    expect(isAllowedAddress('ana@evil-uselets.com', LETS)).toBe(false)
    expect(isAllowedAddress('ana@mail.lets.delivery', LETS)).toBe(false)
    expect(isAllowedAddress('uselets.com', LETS)).toBe(false)
  })

  it('names the domain of an address, and the domains in a sentence', () => {
    expect(domainOf('Ana@Lets.Delivery')).toBe('lets.delivery')
    expect(domainList(LETS)).toBe('uselets.com or lets.delivery')
  })
})

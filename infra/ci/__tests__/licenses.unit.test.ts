import { describe, expect, it } from 'bun:test'

import { coversPackage, declaredLicense, isPermissive, lockedPackages, refusal } from '../licenses.js'

describe('isPermissive', () => {
  it('accepts the permissive licenses the clean room allows', () => {
    for (const license of ['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'PostgreSQL']) {
      expect(isPermissive(license)).toBe(true)
    }
  })

  it('refuses copyleft', () => {
    for (const license of ['GPL-3.0', 'AGPL-3.0-only', 'LGPL-2.1', 'SSPL-1.0']) {
      expect(isPermissive(license)).toBe(false)
    }
  })

  it('takes a dual license under its permissive side', () => {
    expect(isPermissive('(MIT OR GPL-3.0-or-later)')).toBe(true)
  })

  it('refuses a conjunction with any copyleft side', () => {
    expect(isPermissive('MIT AND GPL-3.0')).toBe(false)
  })
})

describe('declaredLicense', () => {
  it('reads the modern string field', () => {
    expect(declaredLicense({ license: 'MIT' })).toBe('MIT')
  })

  it('reads the legacy array as alternatives', () => {
    expect(declaredLicense({ licenses: [{ type: 'MIT' }, { type: 'Apache-2.0' }] })).toBe('(MIT OR Apache-2.0)')
  })

  it('names a missing license rather than passing it', () => {
    expect(declaredLicense({})).toBe('UNKNOWN')
  })
})

describe('refusal', () => {
  it("accepts LET'S own UNLICENSED packages", () => {
    expect(refusal('@uselets/ui', 'UNLICENSED', [])).toBeUndefined()
  })

  it('refuses an unknown license with a reason', () => {
    expect(refusal('mystery', 'UNKNOWN', [])).toBe('UNKNOWN is not on the permissive list')
  })

  it('accepts a reviewed exception only for the exact package and license', () => {
    const reviewed = [{ package: 'lightningcss', license: 'MPL-2.0', because: 'build-time CSS compiler, unmodified' }]

    expect(refusal('lightningcss', 'MPL-2.0', reviewed)).toBeUndefined()
    expect(refusal('lightningcss', 'GPL-3.0', reviewed)).toBeDefined()
  })
})

describe('lockedPackages', () => {
  it('reads plain and scoped packages from bun.lock entries', () => {
    const lock = `"pg": ["pg@8.23.1", "", {}],\n    "@tabler/icons": ["@tabler/icons@3.48.0", "", {}],`

    expect(lockedPackages(lock)).toEqual(new Set(['pg@8.23.1', '@tabler/icons@3.48.0']))
  })

  it('leaves out workspace packages, which are ours and have no published license to check', () => {
    expect(lockedPackages('"@jiraia/web": ["@jiraia/web@workspace:apps/web"],').size).toBe(0)
  })
})

describe('coversPackage', () => {
  it('matches a family of per-platform binaries with a trailing star', () => {
    expect(coversPackage('lightningcss-*', 'lightningcss-linux-x64-musl')).toBe(true)
    expect(coversPackage('lightningcss-*', 'lightningcss')).toBe(false)
  })

  it('matches an exact name exactly', () => {
    expect(coversPackage('argparse', 'argparse-extra')).toBe(false)
  })
})

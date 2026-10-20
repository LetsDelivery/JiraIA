import { z } from 'zod'

/**
 * Whether a package's license lets JiraIA stay 100% Let's code (decisão de clean room).
 *
 * An **allow-list**, not a deny-list: a license nobody has looked at fails, rather than passing
 * because it was not on a list of bad ones. Copyleft (GPL, AGPL, LGPL, SSPL) is never on it — code
 * under those obliges whoever builds on it to publish their own.
 */
export const PERMISSIVE = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
  'PostgreSQL',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0'
])

/** Packages Let's publishes itself. Their `UNLICENSED` means "ours", not "unknown". */
const OWN_SCOPES = ['@uselets/', '@jiraia/']

export const exceptionSchema = z.object({
  package: z.string().min(1),
  license: z.string().min(1),
  because: z.string().min(20)
})
export const exceptionsSchema = z.object({ entries: z.array(exceptionSchema) })
export type LicenseException = z.infer<typeof exceptionSchema>

/**
 * An SPDX expression is acceptable when one side of every `OR` is, and both sides of every `AND`.
 *
 * @example isPermissive('(MIT OR GPL-3.0)')   // true — we take it under MIT
 * @example isPermissive('MIT AND GPL-3.0')    // false
 */
export const isPermissive = (expression: string): boolean => {
  const bare = expression.trim().replace(/^\((.*)\)$/, '$1')

  if (bare.includes(' OR ')) {
    return bare.split(' OR ').some(isPermissive)
  }
  if (bare.includes(' AND ')) {
    return bare.split(' AND ').every(isPermissive)
  }
  return PERMISSIVE.has(bare)
}

/** The license a `package.json` declares, in either of the two shapes npm has used. */
export const declaredLicense = (manifest: { license?: unknown; licenses?: unknown }): string => {
  if (typeof manifest.license === 'string') {
    return manifest.license
  }
  const legacy = Array.isArray(manifest.licenses) ? manifest.licenses : [manifest.license]
  const types = legacy.map((entry) => (entry as { type?: string } | undefined)?.type).filter(Boolean)

  return types.length > 0 ? `(${types.join(' OR ')})` : 'UNKNOWN'
}

/**
 * Whether an exception names this package. A trailing `*` covers a family published as one binary per
 * platform (`lightningcss-*`), so a CI runner on another libc does not need an entry of its own.
 *
 * @example coversPackage('lightningcss-*', 'lightningcss-linux-x64-musl')   // true
 */
export const coversPackage = (pattern: string, name: string): boolean =>
  pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name

/**
 * Why a package is refused, or `undefined` when it is fine.
 *
 * @example refusal('left-pad', 'GPL-3.0', [])   // 'GPL-3.0 is not on the permissive list'
 */
export const refusal = (name: string, license: string, exceptions: readonly LicenseException[]): string | undefined => {
  if (OWN_SCOPES.some((scope) => name.startsWith(scope)) || isPermissive(license)) {
    return undefined
  }
  if (exceptions.some((entry) => coversPackage(entry.package, name) && entry.license === license)) {
    return undefined
  }
  return `${license} is not on the permissive list`
}

/**
 * Every `name@version` the lockfile resolves — what CI actually installs.
 *
 * bun's package store keeps versions a later install no longer uses, so reading the store alone would
 * refuse a package nothing depends on any more and pass on one machine what fails on another.
 *
 * @example lockedPackages('"pg": ["pg@8.23.1", "", {}]')   // Set { 'pg@8.23.1' }
 */
export const lockedPackages = (lockfile: string): Set<string> =>
  new Set([...lockfile.matchAll(/": \["((?:@[^/"]+\/)?[^@"]+@[^"]+)",/g)].map((match) => match[1] as string))

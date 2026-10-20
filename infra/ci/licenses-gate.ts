import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { declaredLicense, exceptionsSchema, lockedPackages, refusal } from './licenses.js'

/**
 * Fails the build on an installed package whose license is not permissive (clean room, 8.5).
 *
 * uselets has no such gate — its `audit` gate reads vulnerabilities, not licenses — so this one is
 * JiraIA's own. It reads every package the lockfile resolves, dev tools included: a build tool under GPL is
 * not a shipping problem, but deciding that is a review, written into `licenses-allowlist.json` with
 * a reason, never a silent pass.
 *
 * Usage: bun run check:licenses
 */
const STORE = 'node_modules/.bun'
const ALLOWLIST_PATH = 'infra/ci/licenses-allowlist.json'

type Installed = { name: string; version: string; license: string }

/** `node_modules/.bun/<entry>/node_modules/<name>` — one directory per installed version. */
const _installed = async (): Promise<Installed[]> => {
  const found = new Map<string, Installed>()

  for (const entry of await readdir(STORE)) {
    for (const manifestPath of await _manifestsIn(join(STORE, entry, 'node_modules'))) {
      const manifest = (await Bun.file(manifestPath).json()) as { name?: string; version?: string; license?: unknown }
      if (manifest.name && manifest.version) {
        found.set(`${manifest.name}@${manifest.version}`, {
          name: manifest.name,
          version: manifest.version,
          license: declaredLicense(manifest)
        })
      }
    }
  }

  return [...found.values()]
}

const _manifestsIn = async (directory: string): Promise<string[]> => {
  const names = await readdir(directory).catch(() => [] as string[])
  const scoped = names.filter((name) => name.startsWith('@'))
  const plain = names.filter((name) => !name.startsWith('@') && name !== '.bin')
  const nested = await Promise.all(
    scoped.map(async (scope) => (await readdir(join(directory, scope))).map((name) => join(scope, name)))
  )

  return [...plain, ...nested.flat()].map((name) => join(directory, name, 'package.json'))
}

const run = async (): Promise<void> => {
  const { entries } = exceptionsSchema.parse(await Bun.file(ALLOWLIST_PATH).json())
  const locked = lockedPackages(await Bun.file('bun.lock').text())
  const installed = (await _installed()).filter((each) => locked.has(`${each.name}@${each.version}`))
  const refused = installed
    .map((each) => ({ ...each, why: refusal(each.name, each.license, entries) }))
    .filter((each) => each.why !== undefined)

  if (refused.length === 0) {
    console.error(`licenses: ${installed.length} installed packages, all permissive or reviewed`)
    return
  }

  console.error(`licenses: ${refused.length} package(s) under a license nobody has cleared\n`)
  for (const each of refused) {
    console.error(`  ${each.name}@${each.version}  ${each.why}`)
  }
  console.error(`\n  Replace the dependency, or review it and add it to ${ALLOWLIST_PATH} with a reason.`)
  process.exit(1)
}

if (import.meta.main) {
  await run()
}

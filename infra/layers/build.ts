/**
 * Builds the shared Lambda layer: third-party dependencies plus the workspace packages.
 *
 * The function packages carry only their own transpiled `.js`, which is what keeps them around a
 * megabyte and under the 3 MB the Lambda console needs to offer its editor (ADR-0010). Everything
 * they import from outside their own `src/` resolves here instead.
 *
 * Two kinds of thing live in `nodejs/node_modules`:
 *
 * 1. Real dependencies, installed from the root `bun.lock` (the `@jiraia/layer` workspace).
 * 2. `@jiraia/*`, transpiled from `packages/`. They are workspace packages, so `bun install` would
 *    never fetch them — and their `exports` points at `src/index.ts`, which a Node runtime cannot
 *    read. Each one is emitted as `.js` with a package.json pointing at the emitted entry.
 *
 * Usage: bun run infra/layers/build.ts
 */

import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { deterministicZip } from '../build/deterministic-zip.js'
import { transpileTree } from '../build/transpile.js'

const BUILD_DIR = 'infra/layers/build'
const LAYER_ROOT = join(BUILD_DIR, 'nodejs')
const MODULES = join(LAYER_ROOT, 'node_modules')
const INSTALL_ROOT = join(BUILD_DIR, 'install')

/**
 * The layer's third-party packages are the `@jiraia/layer` workspace (`infra/layers/package.json`),
 * so they are resolved by the root `bun.lock` like every other workspace and updated by Dependabot
 * under its cooldown. Only runtime dependencies belong there — all layers plus the package share a
 * 250 MB unzipped budget — and anything a service imports must be. `@typesafe-ai/sdk` is the one
 * that looks optional and is not: `integration`'s container imports it whatever the environment, an
 * ESM import resolves at module load, and without it the router dies at init with
 * `ERR_MODULE_NOT_FOUND`.
 *
 * Installed **from the lockfile, frozen**. Until 2026-10-13 this ran `bun install` in a directory
 * with no lockfile, so the thirteen direct versions were exact and everything under them floated to
 * whatever the registry had that day — 21 of 75 packages differed from `bun.lock`. Production ran
 * versions no test had, a package published an hour earlier skipped Dependabot's week, and the
 * layer's hash changed on most merges, redeploying every service (ADR-0114).
 */
const LAYER_WORKSPACE = '@jiraia/layer'

/**
 * A copy of the repository's install surface — the root manifest, the lockfile, bunfig and every
 * workspace's manifest — because `--frozen-lockfile` checks the lockfile against all of them, while
 * `--filter` then installs only the layer's.
 */
const _stageInstallRoot = async (): Promise<void> => {
  const root = JSON.parse(await Bun.file('package.json').text()) as { workspaces: string[] }
  const manifests = root.workspaces.flatMap((pattern) => [
    ...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: '.' })
  ])

  for (const path of ['package.json', 'bun.lock', 'bunfig.toml', ...manifests]) {
    await mkdir(join(INSTALL_ROOT, dirname(path)), { recursive: true })
    await copyFile(path, join(INSTALL_ROOT, path))
  }
}

await rm(BUILD_DIR, { recursive: true, force: true })
await mkdir(LAYER_ROOT, { recursive: true })
await _stageInstallRoot()

// Hoisted, so the layer is a plain `node_modules` Node resolves without the isolated store's
// symlinks; no scripts, so the root's `prepare` and nothing a dependency ships runs here.
const install = Bun.spawnSync(
  [
    'bun',
    'install',
    '--production',
    '--frozen-lockfile',
    '--linker',
    'hoisted',
    '--ignore-scripts',
    '--filter',
    LAYER_WORKSPACE
  ],
  { cwd: INSTALL_ROOT, stdout: 'inherit', stderr: 'inherit' }
)

if (install.exitCode !== 0) {
  console.error(`bun install --frozen-lockfile failed for ${LAYER_WORKSPACE}; is bun.lock current? Run bun install`)
  process.exit(1)
}

await rename(join(INSTALL_ROOT, 'node_modules'), MODULES)
// The workspaces themselves are links into the staged copy; `@jiraia/*` is transpiled below instead.
await rm(join(MODULES, '@jiraia'), { recursive: true, force: true })
await rm(INSTALL_ROOT, { recursive: true, force: true })

/** `@jiraia/testing` is not shipped: nothing deployed imports it, and it holds the test guard. */
const SHIPPED = (name: string): boolean => name !== 'testing'

const packages = (await readdir('packages', { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && SHIPPED(entry.name))
  .map((entry) => entry.name)
  .sort()

for (const name of packages) {
  const target = join(MODULES, '@jiraia', name)
  const result = await transpileTree(join('packages', name), join(target, 'src'))

  await writeFile(
    join(target, 'package.json'),
    `${JSON.stringify(
      {
        name: `@jiraia/${name}`,
        version: '0.1.0',
        type: 'module',
        // `exports` rather than `main`, so the bare specifier `@jiraia/core` resolves and nothing
        // deeper does. A service importing an internal file of a package would be reaching past the
        // interface the package chose to publish.
        exports: { '.': './src/index.js' }
      },
      null,
      2
    )}\n`
  )

  console.error(`  @jiraia/${name}: ${result.files} files, ${(result.bytes / 1024).toFixed(0)} KB`)
}

// The same dependencies are the same bytes, so the deploy can tell a changed layer from an unchanged
// one by its hash alone and publish only the first (ADR-0114).
await Bun.file(join(BUILD_DIR, 'jiraia-deps.zip'))
  .delete()
  .catch(() => undefined)
await deterministicZip({ cwd: BUILD_DIR, target: 'jiraia-deps.zip', keepLinks: false, only: 'nodejs' })

const artifact = Bun.file(join(BUILD_DIR, 'jiraia-deps.zip'))

console.error('')
console.error(`Layer built: ${join(BUILD_DIR, 'jiraia-deps.zip')} (${(artifact.size / 1_048_576).toFixed(1)} MB)`)
console.error(`  ${LAYER_WORKSPACE} from bun.lock, ${packages.length} workspace packages`)
// `buildspec.yml` uploads this zip beside `app.zip`; the stack's `DepsLayer` publishes it (ADR-0025).

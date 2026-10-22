/**
 * Packages a service for Lambda: transpile to `.js`, link the layer, zip.
 *
 * Three things happen here, and the second is the non-obvious one.
 *
 * 1. `src/**\/*.ts` becomes `app/**\/*.js`, a 1:1 mirror. Small files, browsable and editable in the
 *    Lambda console (ADR-0010).
 *
 * 2. `app/node_modules` is a symlink to `/opt/nodejs/node_modules`. Lambda exposes a layer's modules
 *    through `NODE_PATH`, and **the ESM resolver ignores `NODE_PATH`** — it walks `node_modules`
 *    directories up from the importing file and never looks at `/opt`. Verified: without the link,
 *    `import '@jiraia/core'` from `/var/task/config.js` fails with `ERR_MODULE_NOT_FOUND`. The
 *    symlink puts a `node_modules` where the resolver already looks.
 *
 * 3. The zip is built here, keeping links. Without that, zip resolves the symlink, finds nothing at
 *    `/opt` on a build machine, and **silently drops it** — producing a package that passes every
 *    local check and dies on the first cold start. `buildspec.yml` uploads this very zip and
 *    `template.yml` points the function's `Code` at it, so nothing re-packs it (ADR-0025).
 *
 * `work` also carries the built panel, under `panel/`: the deploy publishes it from there to the
 * bucket CloudFront serves, so the API and the panel that speaks to it ship as one artifact.
 *
 * Usage:
 *   bun run infra/build/package.ts                 # every service
 *   bun run infra/build/package.ts security tms    # only these
 */

import { cp, readdir, symlink, unlink } from 'node:fs/promises'
import { join } from 'node:path'

import { deterministicZip } from './deterministic-zip.js'
import { transpileTree } from './transpile.js'

/** Where Lambda mounts a layer's `nodejs/node_modules`. Absolute, because /var/task is not its parent. */
const LAYER_MODULES = '/opt/nodejs/node_modules'

/** The console offers its editor below this; above it, the package is read-only. */
const CONSOLE_EDIT_LIMIT = 3 * 1024 * 1024

const _link = async (appDir: string): Promise<void> => {
  const link = join(appDir, 'node_modules')

  await unlink(link).catch(() => undefined)
  await symlink(LAYER_MODULES, link, 'dir')
}

/** Through `deterministicZip`, so an unchanged service is an unchanged package and its stack a no-op. */
const _zip = async (serviceDir: string): Promise<void> =>
  await deterministicZip({ cwd: join(serviceDir, 'app'), target: '../app.zip', keepLinks: true })

/**
 * A service that owns tables ships its Drizzle migrations beside its code, so its `migrate` handler
 * applies exactly the migrations of the version being deployed (ADR-0002).
 */
const _withMigrations = async (serviceDir: string, appDir: string): Promise<void> => {
  const migrations = join(serviceDir, 'drizzle')

  if (await Bun.file(join(migrations, 'meta', '_journal.json')).exists()) {
    await cp(migrations, join(appDir, 'drizzle'), { recursive: true })
  }
}

/** `bun run web:build` writes the panel here; `bun run build` runs it first. */
const PANEL_DIST = join('apps', 'web', 'dist')

/** The service whose deploy publishes the panel (`template.yml`, the `Deploy` custom resource). */
const PANEL_SERVICE = 'work'

const _withPanel = async (service: string, appDir: string): Promise<void> => {
  if (service !== PANEL_SERVICE) {
    return
  }
  if (!(await Bun.file(join(PANEL_DIST, 'index.html')).exists())) {
    throw new Error(`No panel at "${PANEL_DIST}" to package with ${service}; run \`bun run web:build\` first`)
  }
  await cp(PANEL_DIST, join(appDir, 'panel'), { recursive: true })
}

export type PackageResult = { files: number; unzipped: number; zipped: number }

export const packageService = async (service: string): Promise<PackageResult> => {
  const serviceDir = join('services', service)
  const appDir = join(serviceDir, 'app')

  await Bun.file(join(serviceDir, 'app.zip'))
    .delete()
    .catch(() => undefined)

  const result = await transpileTree(serviceDir, appDir)
  await _withMigrations(serviceDir, appDir)
  await _withPanel(service, appDir)
  await _link(appDir)
  await _zip(serviceDir)

  return {
    files: result.files,
    unzipped: result.bytes,
    zipped: Bun.file(join(serviceDir, 'app.zip')).size
  }
}

if (import.meta.main) {
  const requested = Bun.argv.slice(2)
  const all = (await readdir('services', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

  const unknown = requested.filter((name) => !all.includes(name))

  if (unknown.length > 0) {
    console.error(`unknown service(s): ${unknown.join(', ')}. Known: ${all.join(', ')}`)
    process.exit(1)
  }

  const services = requested.length > 0 ? requested : all
  let oversized = 0

  for (const service of services) {
    const { files, unzipped, zipped } = await packageService(service)

    // A package over the limit still deploys and still runs; it just loses the console editor, which
    // is the whole reason the dependencies are in a layer. Worth failing the build over rather than
    // discovering in the console months later.
    const editable = unzipped < CONSOLE_EDIT_LIMIT
    if (!editable) {
      oversized += 1
    }

    console.error(
      `${service.padEnd(11)} ${String(files).padStart(3)} files  ` +
        `${(unzipped / 1024).toFixed(0).padStart(4)} KB unzipped  ` +
        `${(zipped / 1024).toFixed(0).padStart(4)} KB zipped  ` +
        `${editable ? 'console-editable' : 'TOO LARGE for the console editor'}`
    )
  }

  if (oversized > 0) {
    console.error('')
    console.error(`${oversized} package(s) exceed ${CONSOLE_EDIT_LIMIT / 1024 / 1024} MB unzipped.`)
    process.exit(1)
  }
}

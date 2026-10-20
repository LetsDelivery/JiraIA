/**
 * Produces the deployable JavaScript: a 1:1 mirror of each `src/` tree as `.js`.
 *
 * The point is the feedback loop. A change can be made in the Lambda console, saved, and observed
 * immediately; when it works, the same change is written into the `.ts` for the next deploy
 * (ADR-0010). That needs the package under 3 MB, so dependencies live in a layer, and it needs the
 * emitted file to be readable and to line up with its source, so bundling is out.
 *
 * Why `tsc` and not `Bun.Transpiler`, which this used first:
 *
 * - `Bun.Transpiler` strips comments and offers no way to keep them. Measured on
 *   `auth.service.ts`: 117 source lines became 56. This codebase's comments carry the *why*, and
 *   reading the code in the console is half of the loop above — an emitted file with the reasoning
 *   removed is materially harder to change correctly.
 * - `tsc` keeps them, JSDoc and inline body comments alike, and only removes types. Same file: 117
 *   lines became 82, and every comment survived.
 *
 * The alternatives that were ruled out earlier still are: `bun build --no-bundle` does not rewrite
 * import specifiers and, on bun 1.3.11, writes nothing when given `--outdir` with several
 * entrypoints; `bun build` in bundling mode inlines imported modules into each entrypoint.
 *
 * tsc typechecks as it emits, so a build failure here is a real one. `bunx tsc --noEmit` over the
 * whole repository, tests included, remains the gate that runs first.
 */

import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Where the single tsc pass puts everything, mirroring the repository layout. */
export const EMIT_DIR = '.emit'

let emitted = false

/**
 * Runs tsc once over the monorepo. Repeated calls are free.
 *
 * One pass rather than one per service: a service's imports resolve through the workspace symlinks
 * into `packages/`, so a per-service `rootDir` makes tsc refuse to place their output (TS6059). The
 * usual answer is project references plus `.d.ts` files, and this project has neither.
 */
export const emitAll = async (): Promise<void> => {
  if (emitted) {
    return
  }

  await rm(EMIT_DIR, { recursive: true, force: true })

  const result = Bun.spawnSync(['bunx', 'tsc', '-p', 'tsconfig.emit.json'], {
    stdout: 'inherit',
    stderr: 'inherit'
  })

  if (result.exitCode !== 0) {
    console.error('tsc failed; the build cannot produce a package')
    process.exit(1)
  }

  emitted = true
}

const _measure = async (dir: string): Promise<{ files: number; bytes: number }> => {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.js'))

  const sizes = await Promise.all(files.map((entry) => stat(join(entry.parentPath, entry.name))))

  return { files: files.length, bytes: sizes.reduce((total, size) => total + size.size, 0) }
}

export type TranspileResult = { files: number; bytes: number }

/**
 * Copies one emitted tree into place.
 *
 * @example await transpileTree('services/security', 'services/security/app')
 */
export const transpileTree = async (source: string, target: string): Promise<TranspileResult> => {
  await emitAll()

  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(join(EMIT_DIR, source, 'src'), target, { recursive: true })

  // Without this the runtime reads the emitted `export` as CommonJS and the cold start dies on
  // "Cannot use import statement outside a module". The service's own package.json is not shipped.
  await writeFile(join(target, 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`)

  return await _measure(target)
}

if (import.meta.main) {
  const target = Bun.argv[2]

  if (!target) {
    console.error('usage: bun run infra/build/transpile.ts <services/name | packages/name> [--out <dir>]')
    process.exit(1)
  }

  const rest = Bun.argv.slice(3)
  const outFlag = rest.indexOf('--out')
  const out = outFlag === -1 ? join(target, 'app') : rest[outFlag + 1]

  if (!out) {
    console.error('--out was given without a directory')
    process.exit(1)
  }

  const result = await transpileTree(target, out)

  console.error(`${target} -> ${out}: ${result.files} files, ${(result.bytes / 1024).toFixed(0)} KB`)
}

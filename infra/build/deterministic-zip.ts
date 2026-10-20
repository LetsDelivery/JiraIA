import { lstat, lutimes, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * A zip whose bytes depend on the files' contents and nothing else.
 *
 * `zip -r` records each file's modification time and walks the directory in whatever order the
 * filesystem answers, so two builds of an unchanged service were two different zips. `sam deploy`
 * then uploaded a new package for every function on every run and no stack was ever a no-op — which
 * is most of the fifteen minutes a pipeline deploy took (ADR-0114). Here every entry gets one fixed
 * time, the list is sorted, and `-X` leaves out the owner and the extra timestamps: the same tree is
 * the same bytes, on a laptop or in CodeBuild.
 *
 * `keepLinks` is `zip -y`, which the service packages need for their `node_modules` link (ADR-0010).
 *
 * @example await deterministicZip({ cwd: 'services/oms/app', target: '../app.zip', keepLinks: true })
 * @example await deterministicZip({ cwd: 'infra/layers/build', target: 'jiraia-deps.zip', keepLinks: false, only: 'nodejs' })
 */
export const FIXED_TIME = new Date('2026-01-01T00:00:00Z')

export const deterministicZip = async (input: {
  cwd: string
  target: string
  keepLinks: boolean
  /** Only this subdirectory of `cwd`, with its own name kept on every entry. The whole of `cwd` otherwise. */
  only?: string
}): Promise<void> => {
  const entries = (await _walk(input.cwd, input.only ? join(input.cwd, input.only) : input.cwd)).sort()

  for (const entry of entries) {
    await lutimes(join(input.cwd, entry), FIXED_TIME, FIXED_TIME)
  }

  const zip = Bun.spawn(['zip', '-q9', '-X', '-D', ...(input.keepLinks ? ['-y'] : []), input.target, '-@'], {
    cwd: input.cwd,
    stdin: new TextEncoder().encode(`${entries.join('\n')}\n`),
    // A zip stores local time. UTC everywhere, or a laptop at UTC-3 and CodeBuild at UTC write the
    // same tree as two different zips.
    env: { ...process.env, TZ: 'UTC' },
    stdout: 'inherit',
    stderr: 'inherit'
  })

  if ((await zip.exited) !== 0) {
    throw new Error(`zip of ${input.cwd} into ${input.target} failed; expected the zip binary on PATH`)
  }
}

/** Every file and link under `dir`, relative to `root`. A link is an entry, never followed. */
const _walk = async (root: string, dir: string): Promise<string[]> => {
  const found: string[] = []

  for (const name of await readdir(dir)) {
    const path = join(dir, name)
    const stat = await lstat(path)
    found.push(...(stat.isDirectory() ? await _walk(root, path) : [relative(root, path)]))
  }

  return found
}

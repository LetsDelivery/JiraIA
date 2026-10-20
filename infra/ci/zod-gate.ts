/**
 * Fails the build on a zod method zod itself has deprecated.
 *
 * Zod 4 moved the string formats out of `ZodString` and onto the top level — `z.iso.datetime()`,
 * `z.url()`, `z.uuid()` — and replaced `A.merge(B)` with `A.extend(B.shape)`. The old spellings
 * still work, which is exactly the problem: nothing fails, so they accumulate. This repository had
 * 47 of them across 29 files before anybody looked.
 *
 * That matters more here than in most projects. **A zod schema is the only place a type is
 * declared** — there are no `.d.ts` files — so the schema layer is the type layer, and a codebase
 * where the same constraint is written two ways is one where nobody can grep for it. The migration
 * being mechanical is the argument for automating it, not for leaving it.
 *
 * `tsc` will not do this: a `@deprecated` JSDoc tag is an editor hint and never a compile error,
 * and biome has no rule for arbitrary deprecations either.
 *
 * The list comes from `zod/v4/classic/schemas.d.cts` — every method carrying `@deprecated` that this
 * repository could plausibly write. When zod deprecates the next one, add it here and the build
 * names every call site.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** `deprecated` -> what to write instead. */
const REPLACEMENTS: Record<string, string> = {
  'z.string().datetime()': 'z.iso.datetime()',
  'z.string().date()': 'z.iso.date()',
  'z.string().time()': 'z.iso.time()',
  'z.string().duration()': 'z.iso.duration()',
  'z.string().email()': 'z.email()',
  'z.string().url()': 'z.url()',
  'z.string().uuid()': 'z.uuid()',
  'z.string().guid()': 'z.guid()',
  'z.string().nanoid()': 'z.nanoid()',
  'z.string().ulid()': 'z.ulid()',
  'z.string().cuid2()': 'z.cuid2()',
  'z.string().jwt()': 'z.jwt()',
  'z.string().emoji()': 'z.emoji()',
  'z.string().base64()': 'z.base64()',
  'z.string().base64url()': 'z.base64url()',
  'z.string().ipv4()': 'z.ipv4()',
  'z.string().ipv6()': 'z.ipv6()',
  'z.string().cidrv4()': 'z.cidrv4()',
  'z.string().cidrv6()': 'z.cidrv6()',
  'z.string().e164()': 'z.e164()',
  'z.string().xid()': 'z.xid()',
  'z.string().ksuid()': 'z.ksuid()',
  'z.number().finite()': 'z.number()',
  'z.number().step(': 'z.number().multipleOf(',
  'z.nativeEnum(': 'z.enum(',
  '.merge(': '.extend(<other>.shape) — zod 4 deprecated .merge()',
  '.passthrough()': '.loose()',
  '.nonstrict()': '.loose()',
  '.deepPartial()': 'a partial schema written where it is used'
}

const ROOTS = ['services', 'packages', 'infra']

/** This file lists the spellings it forbids; it must not trip over its own list. */
const EXEMPT = ['infra/ci/zod-gate.ts']

const _isComment = (line: string): boolean => {
  const trimmed = line.trim()

  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

type Offence = { file: string; line: number; found: string; instead: string; source: string }

const _walk = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)

      if (entry.isDirectory()) {
        return entry.name === 'node_modules' ? [] : await _walk(path)
      }

      return path.endsWith('.ts') ? [path] : []
    })
  )

  return found.flat()
}

const _scan = async (file: string): Promise<Offence[]> => {
  const source = await Bun.file(file).text()

  return source.split('\n').flatMap((line, index) => {
    if (_isComment(line)) {
      return []
    }

    const hit = Object.keys(REPLACEMENTS).find((deprecated) => line.includes(deprecated))

    return hit ? [{ file, line: index + 1, found: hit, instead: REPLACEMENTS[hit] ?? '', source: line.trim() }] : []
  })
}

const run = async (): Promise<void> => {
  const files = (await Promise.all(ROOTS.map(async (root) => await _walk(root)))).flat()
  const offences = (
    await Promise.all(
      files.filter((file) => !EXEMPT.some((allowed) => file.endsWith(allowed))).map(async (f) => await _scan(f))
    )
  ).flat()

  if (offences.length === 0) {
    console.error(`zod: no deprecated zod calls in ${files.length} files`)
    return
  }

  console.error(`zod: ${offences.length} deprecated call(s)\n`)

  for (const offence of offences) {
    console.error(`  ${offence.file}:${offence.line}  ${offence.found} -> ${offence.instead}`)
    console.error(`    ${offence.source}`)
  }

  process.exit(1)
}

await run()

/**
 * Fails the build on an outbound HTTP call that does not go through `createHttpClient`. Copied from
 * LetsDelivery/uselets.
 *
 * Every call that leaves the platform must carry what only one shared client sets: a structured log
 * line naming the provider, host, status and duration; sensitive headers redacted from it; and no
 * hidden retries, because the consumer's queue is the only retry that knows whether a write was safe
 * to repeat. uselets found a partner's live token logged thousands of times a day by a call that
 * bypassed its client.
 *
 * `createHttpClient` (packages/http/src/client.ts) arrived with Slack, the first outbound integration
 * (Etapa 5); it is the one file allowed to call `fetch` itself.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const ROOTS = ['services', 'packages']

/**
 * `import got …` / `require('got')` where `got` arrives as a *value*.
 *
 * `import type { Got }` and `import { type Got }` are the legitimate spelling and both are excluded
 * by the negative lookaheads — the second one matters, because it is the form biome rewrites to.
 */
const VALUE_IMPORT = /^\s*import\s+(?!type\s)(?![^'"]*\{\s*type\s)[^'"]*from\s+['"]got['"]/

/**
 * `got(…)`, `got.post(…)`, `got.extend(…)` — the call itself, wherever the name came from.
 *
 * The trailing `$` is not decoration. Every one of the six call sites this gate was written for is
 * formatted `const body = await got` with the `.post(` on the next line, which is what biome does to
 * a chain this long — so a regex anchored on `got.` matched none of them.
 */
const GOT_CALL = /(?<![\w.$])got\s*(?:[.(]|$)/

/**
 * The platform's own `fetch`, which bypasses the client just as completely.
 *
 * Guarded against `_fetch(` and `this.fetch(` — `aws-secret-store.ts` has a private helper by that
 * name and it is not what this is about.
 */
const RAW_FETCH = /(?<![\w.$])fetch\s*\(/

/** `offline.ts` patches `fetch` to refuse remote hosts in tests; `client.ts` is the shared client. */
const EXEMPT = ['packages/testing/src/offline.ts', 'packages/http/src/client.ts']

const _isExempt = (file: string): boolean => EXEMPT.some((allowed) => file.endsWith(allowed))

/**
 * A test may reach for either.
 *
 * It stands up a local socket and drives the adapter against it, so the call under test still goes
 * through the client; what the *test* uses to assert on it is its own business.
 */
const _isTest = (file: string): boolean =>
  file.includes('__tests__') || file.includes('/tests/') || file.endsWith('.test.ts')

/** Comments explain the trap; they must not trip it. */
const _isComment = (line: string): boolean => {
  const trimmed = line.trim()

  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

type Offence = { file: string; line: number; what: string; source: string }

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

const _offenceOn = (line: string): string | undefined => {
  if (VALUE_IMPORT.test(line)) {
    return 'imports `got` as a value'
  }

  if (GOT_CALL.test(line)) {
    return 'calls `got` directly'
  }

  return RAW_FETCH.test(line) ? 'calls `fetch` directly' : undefined
}

const _scan = async (file: string): Promise<Offence[]> => {
  const source = await Bun.file(file).text()

  return source.split('\n').flatMap((line, index) => {
    if (_isComment(line)) {
      return []
    }

    const what = _offenceOn(line)

    return what ? [{ file, line: index + 1, what, source: line.trim() }] : []
  })
}

const run = async (): Promise<void> => {
  const all = (await Promise.all(ROOTS.map(async (root) => await _walk(root)))).flat()
  const files = all.filter((file) => !_isExempt(file) && !_isTest(file))
  const offences = (await Promise.all(files.map(async (file) => await _scan(file)))).flat()

  if (offences.length === 0) {
    console.error(`http: every outbound call goes through createHttpClient, across ${files.length} files`)
    return
  }

  console.error(`http: ${offences.length} outbound call(s) bypassing createHttpClient\n`)

  for (const offence of offences) {
    console.error(`  ${offence.file}:${offence.line}  ${offence.what}`)
    console.error(`    ${offence.source}`)
  }

  console.error('\n  Every outbound call goes through one shared createHttpClient, which logs the provider,')
  console.error('  redacts headers and holds retries at zero. The first integration creates it.')
  process.exit(1)
}

await run()

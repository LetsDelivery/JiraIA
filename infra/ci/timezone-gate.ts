/**
 * Fails the build on a local-time `Date` method. Copied from LetsDelivery/uselets.
 *
 * Every Lambda runs with `TZ=UTC`, so `getHours()` is a UTC hour and `setHours(12)` is noon UTC. For
 * a person in São Paulo each of those is three hours out — and both halves compile and are right on
 * a laptop in Brazil and wrong in production. uselets found exactly this in the legacy platform.
 *
 * Say what you mean instead: the `getUTC*` family when the answer is UTC. Dates shown to a person are
 * formatted in `America/Sao_Paulo` by the web app, never computed in local time by the API.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** The `Date` members that silently read `process.env.TZ`. */
const LOCAL_MEMBERS = [
  'getHours',
  'setHours',
  'getMinutes',
  'setMinutes',
  'getSeconds',
  'setSeconds',
  'getDate',
  'setDate',
  'getDay',
  'getMonth',
  'setMonth',
  'getFullYear',
  'setFullYear',
  'getMilliseconds',
  'setMilliseconds'
] as const

const CALL = new RegExp(`\\.(${LOCAL_MEMBERS.join('|')})\\s*\\(`)

/**
 * `toLocaleString` and friends are only a problem without an explicit zone.
 *
 * With one they are the correct tool — `localParts` is built on `Intl.DateTimeFormat`. Without one
 * they fall back to the machine's zone, which is the same bug wearing a longer name.
 *
 * **A locale is not a zone**, and this used to match only the zero-argument form — so
 * `toLocaleString('pt-BR')` sailed through, which is precisely the shape the bug takes when
 * somebody remembers the language and forgets the clock. The web client had exactly that line.
 *
 * The one legitimate zoneless call is a *number*: money and percentages have no timezone, and
 * `style` is how a number format says so. That is the whole allow-list.
 */
const LOCALE_CALL = /\.(toLocaleString|toLocaleDateString|toLocaleTimeString)\s*\(([^)]*)\)/g

const NUMBER_STYLES = ['currency', 'percent', 'decimal', 'unit']

/** Whether a `toLocale*` call on this line renders an instant without saying on which clock. */
const _rendersOnTheMachineClock = (line: string): boolean => {
  for (const match of line.matchAll(LOCALE_CALL)) {
    const args = match[2] ?? ''

    if (!args.includes('timeZone') && !NUMBER_STYLES.some((style) => args.includes(style))) {
      return true
    }
  }

  return false
}

const ROOTS = ['services', 'packages']

/** Comments explain the trap; they must not trip it. */
const _isComment = (line: string): boolean => {
  const trimmed = line.trim()

  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

type Offence = { file: string; line: number; member: string; source: string }

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

  return source
    .split('\n')
    .flatMap((line, index) => {
      if (_isComment(line)) {
        return []
      }

      const member = CALL.exec(line)

      if (member) {
        return [{ file, line: index + 1, member: member[1] ?? '', source: line.trim() }]
      }

      if (_rendersOnTheMachineClock(line)) {
        return [{ file, line: index + 1, member: 'toLocale* without a timeZone', source: line.trim() }]
      }

      return []
    })
    .filter((offence) => offence.member !== '')
}

/**
 * `zone.ts` is the one module allowed to touch them, and it does so on values it built itself with
 * `Date.UTC` — which is why the exemption is a single file and not a pattern.
 */
const EXEMPT: string[] = []

const _isExempt = (file: string): boolean => EXEMPT.some((allowed) => file.endsWith(allowed))

const run = async (): Promise<void> => {
  const files = (await Promise.all(ROOTS.map(async (root) => await _walk(root)))).flat()
  const offences = (await Promise.all(files.filter((file) => !_isExempt(file)).map(async (f) => await _scan(f)))).flat()

  if (offences.length === 0) {
    console.error(`timezone: no local-time Date calls in ${files.length} files`)
    return
  }

  console.error(`timezone: ${offences.length} local-time Date call(s); every Lambda runs with TZ=UTC\n`)

  for (const offence of offences) {
    console.error(`  ${offence.file}:${offence.line}  ${offence.member}`)
    console.error(`    ${offence.source}`)
  }

  console.error('\n  Use the getUTC*/setUTC* family. A wall-clock date is formatted by the web app in')
  console.error('  America/Sao_Paulo, never computed in local time by the API.')
  process.exit(1)
}

await run()

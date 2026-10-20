/**
 * Fails the build on prose a mechanical rename broke. Copied from LetsDelivery/uselets.
 *
 * A rename by regex cannot tell a domain noun from a verb. In uselets one turned a noun into a verb
 * across 133 files, twenty-two sentences came out wrong, and every other gate passed — none of them
 * reads English. Here the nouns most likely to be renamed are the domain's own (`card`, `space`,
 * `project`, `member`, `agent`), so the same pattern is watched for those: a domain noun followed by
 * a direct object reads as a verb, which is wrong by construction.
 *
 * **This is a backstop, not the method.** The method is in `AGENTS.md`: a mechanical rename is
 * reviewed by reading `git diff --word-diff`.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Domain nouns that are **never** verbs in English.
 *
 * That is the whole claim this rests on, and it is a fact about the language rather than about this
 * codebase — so `cards` followed by a direct object is wrong by construction, with no judgement
 * required. Most of the glossary cannot be listed here for exactly that reason: `order`, `charge`,
 * `return`, `chain` and `stop` are all verbs, and "the rule stops the sweep" is fine.
 *
 * A short list is a list that does not go stale. Add a term only when it is a noun and nothing else.
 */
const NOUNS = 'card space project member agent'.split(' ')

/**
 * A word before the noun that makes it plainly a noun, so whatever follows is a relative clause.
 *
 * "the cards a member may reach" and "thousands of cards a scan would touch" are both correct
 * and both look exactly like the broken shape without this.
 */
const DETERMINER = new Set(
  `the a an this that these those which what whose several many few all some both each every other
   of no its their our your more most fewer two three hundred thousand thousands n`.split(/\s+/)
)

/**
 * A word after the noun that means it has taken a direct object — so it was read as a verb.
 *
 * `that`, `this` and `those` are deliberately absent. After a plural noun they are relative
 * pronouns far more often than objects ("five cards that arrived late"), and including them was
 * the single largest source of false positives while this was being tuned.
 */
const OBJECT = new Set('the a an it its them their what whatever anything everything something'.split(' '))

/** A possessive immediately followed by the same word: `a card's card`. */
const DOUBLED = /\b(\w+)['’]s \1\b/i

/**
 * Where the prose is.
 *
 * `.agents` is on this list for the same reason `AGENTS.md` is on `ROOT_FILES`: the skills in it
 * are committed instructions an agent reads as fact, so a sentence a rename broke there is not
 * merely read wrong, it is carried into the next change.
 */
const ROOTS = ['services', 'packages', 'infra', 'apps/web/src', 'docs']

/** Not ours to read: dependencies, and the three build outputs that mirror the source. */
const SKIP = ['node_modules', 'dist', 'app', '.emit']

export type Offence = { file: string; line: number; reason: string; source: string }

/**
 * Inline code is not prose.
 *
 * `GET /work/spaces` is a route and `cognito:groups` is a claim; neither is a sentence. Blanking
 * them is what takes this rule from unusable to usable — they were forty of the first fifty-six
 * hits, and every one was noise.
 */
const _prose = (line: string): string => line.replace(/`[^`]*`/g, ' § ')

const _wordBefore = (line: string, at: number): string =>
  line
    .slice(0, at)
    .replace(/[^A-Za-z\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .pop()
    ?.toLowerCase() ?? ''

const _wordAfter = (line: string, at: number): string =>
  line
    .slice(at)
    .trim()
    .split(/[\s,.;:)]+/)[0]
    ?.toLowerCase() ?? ''

/** One noun, used as a verb, on one line. */
const _verbSlot = (line: string, noun: string): number | undefined => {
  for (const match of line.matchAll(new RegExp(`\\b${noun}s\\b`, 'gi'))) {
    const at = match.index ?? 0

    if (DETERMINER.has(_wordBefore(line, at))) {
      continue
    }

    if (OBJECT.has(_wordAfter(line, at + match[0].length))) {
      return at
    }
  }

  return undefined
}

/**
 * Whether this line is code rather than prose, given what came before it.
 *
 * Markdown has two code blocks and both matter here: the fenced kind, and four spaces of indent —
 * which is how two ADRs and one service's AGENTS.md draw their route tables. A route is not a
 * sentence, and `GET /members/{memberId}/cards what they reach` reads exactly like the bug.
 */
const _isCode = (raw: string, file: string, fenced: boolean): boolean =>
  fenced || (file.endsWith('.md') && /^ {4}/.test(raw))

/** Every offence in one file. Exported because the walk around it cannot be tested and this can. */
export const offencesIn = (file: string, source: string): Offence[] => {
  const found: Offence[] = []
  let fenced = false

  source.split('\n').forEach((raw, index) => {
    if (raw.trimStart().startsWith('```')) {
      fenced = !fenced
      return
    }

    if (_isCode(raw, file, fenced)) {
      return
    }

    found.push(..._offencesOn(file, index + 1, _prose(raw)))
  })

  return found
}

const _offencesOn = (file: string, line: number, prose: string): Offence[] => {
  const doubled = DOUBLED.exec(prose)

  if (doubled) {
    return [{ file, line, reason: `"${doubled[0]}" — a rename replaced the second word`, source: prose.trim() }]
  }

  for (const noun of NOUNS) {
    if (_verbSlot(prose, noun) !== undefined) {
      return [{ file, line, reason: `"${noun}s" has taken an object, so it was read as a verb`, source: prose.trim() }]
    }
  }

  return []
}

/**
 * Every file worth reading under a directory.
 *
 * The skip list is the load-bearing part: without `node_modules` on it this walks the dependency
 * tree, takes minutes, and reports on prose nobody here wrote.
 */
export const filesUnder = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)

      if (entry.isDirectory()) {
        return SKIP.includes(entry.name) ? [] : await filesUnder(path)
      }

      return /\.(ts|tsx|md)$/.test(entry.name) ? [path] : []
    })
  )

  return found.flat()
}

/**
 * This gate's own tests, and nothing else.
 *
 * Its fixtures **are** the broken sentences — that is what makes them fixtures — and unlike the
 * examples in the docblock above they cannot be wrapped in backticks, because backticked text is
 * exactly what this blanks. A file-level exemption rather than a pattern, so it covers one file
 * whose whole purpose is to contain these and covers nothing by accident.
 */
const EXEMPT: string[] = []

/** The four at the repository root are the ones most read, and `AGENTS.md` is read as instructions. */
const ROOT_FILES = ['AGENTS.md', 'CONTEXT.md', 'README.md', 'CLAUDE.md']

const run = async (): Promise<void> => {
  const walked = (await Promise.all(ROOTS.map(async (root) => await filesUnder(root)))).flat()
  const files = [...walked, ...ROOT_FILES].filter((file) => !EXEMPT.includes(file))
  const offences = (
    await Promise.all(
      files.map(async (file) =>
        offencesIn(
          file,
          await Bun.file(file)
            .text()
            .catch(() => '')
        )
      )
    )
  ).flat()

  if (offences.length === 0) {
    console.error(`prose: no domain noun used as a verb in ${files.length} files`)
    return
  }

  console.error(`prose: ${offences.length} sentence(s) a rename broke\n`)

  for (const offence of offences) {
    console.error(`  ${offence.file}:${offence.line}  ${offence.reason}`)
    console.error(`    ${offence.source}`)
  }

  console.error('\n  A rename by regex cannot tell a domain noun from a verb.')
  console.error('  Read `git diff --word-diff` on the commit that did it.')
  process.exit(1)
}

if (import.meta.main) {
  await run()
}

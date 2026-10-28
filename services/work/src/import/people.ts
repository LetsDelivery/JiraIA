import { ValidationException } from '@jiraia/core'
import { z } from 'zod'

/**
 * Etapa 8b (ADR-0036): who is who across Jira and Confluence. Every account the raw copy mentions is
 * listed with a proposal — the JiraIA member it becomes, or only its name — for a person to review.
 * One person often has several Atlassian accounts on different domains; they become one member, keyed
 * by the `uselets.com` address they sign in with (ADR-0005).
 */
export const HOME_DOMAIN = 'uselets.com'

/** `557058:…`/`712020:<uuid>` or the older 24-hex ids. */
const ACCOUNT_ID = /^(\d+:[0-9a-f-]{36}|[0-9a-f]{24})$/
const ID_KEYS = /(authorId|ownerId|AccountId)$/

export type Account = {
  accountId: string
  name: string | undefined
  email: string | undefined
  active: boolean | undefined
  accountType: string | undefined
  occurrences: number
}

type Found = Map<string, Account>

const record = (found: Found, id: string, details: Partial<Account> = {}): void => {
  const known = found.get(id) ?? {
    accountId: id,
    name: undefined,
    email: undefined,
    active: undefined,
    accountType: undefined,
    occurrences: 0
  }
  found.set(id, {
    accountId: id,
    name: known.name ?? details.name,
    email: known.email ?? details.email,
    active: known.active ?? details.active,
    accountType: known.accountType ?? details.accountType,
    occurrences: known.occurrences + 1
  })
}

const asUser = (node: Record<string, unknown>): Partial<Account> => ({
  name: typeof node.displayName === 'string' ? node.displayName : undefined,
  email: typeof node.emailAddress === 'string' ? node.emailAddress.toLowerCase() : undefined,
  active: typeof node.active === 'boolean' ? node.active : undefined,
  accountType: typeof node.accountType === 'string' ? node.accountType : undefined
})

/** An Atlassian document kept as a JSON string (Confluence's `atlas_doc_format.value`). */
const embeddedDocument = (key: string, value: string): unknown => {
  if (key !== 'value' || !value.startsWith('{')) {
    return undefined
  }
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const recordUser = (node: Record<string, unknown>, found: Found): void => {
  if (typeof node.accountId === 'string' && ACCOUNT_ID.test(node.accountId)) {
    record(found, node.accountId, asUser(node))
  }
}

const recordMention = (node: Record<string, unknown>, found: Found): void => {
  const id = (node.attrs as { id?: unknown } | undefined)?.id
  if (node.type === 'mention' && typeof id === 'string' && ACCOUNT_ID.test(id)) {
    record(found, id)
  }
}

const visitEntry = (key: string, value: unknown, found: Found): void => {
  if (typeof value !== 'string') {
    collectAccounts(value, found)
  } else if (ID_KEYS.test(key) && ACCOUNT_ID.test(value)) {
    record(found, value)
  } else {
    collectAccounts(embeddedDocument(key, value), found)
  }
}

const visitObject = (node: Record<string, unknown>, found: Found): void => {
  recordUser(node, found)
  recordMention(node, found)
  for (const [key, value] of Object.entries(node)) {
    if (key !== 'accountId') {
      visitEntry(key, value, found)
    }
  }
}

/**
 * Every account a raw document mentions: Jira's user objects (with name and e-mail when Atlassian
 * shows them), Confluence's `authorId`/`ownerId`, changelog `tmpTo/FromAccountId`, and `@mentions`.
 */
export const collectAccounts = (value: unknown, found: Found = new Map()): Found => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectAccounts(item, found)
    }
  } else if (value !== null && typeof value === 'object') {
    visitObject(value as Record<string, unknown>, found)
  }
  return found
}

/** One row of the admin's user export: the only place an e-mail hidden by profile privacy shows. */
export type DirectoryEntry = { accountId: string; name: string; email: string; status: string }

/** The user export's CSV, by its header names; quoted cells allowed. */
export const parseDirectory = (csv: string): DirectoryEntry[] => {
  const [header, ...rows] = csv.trim().split(/\r?\n/).map(splitCsvLine)
  const column = (name: string) => header?.findIndex((cell) => cell.toLowerCase() === name) ?? -1
  const at = { id: column('user id'), name: column('user name'), email: column('email'), status: column('user status') }
  return rows.map((cells) => ({
    accountId: cells[at.id] ?? '',
    name: cells[at.name] ?? '',
    email: (cells[at.email] ?? '').toLowerCase(),
    status: cells[at.status] ?? ''
  }))
}

const splitCsvLine = (line: string): string[] => {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(cell)
      cell = ''
    } else {
      cell += char
    }
  }
  return [...cells, cell]
}

/** How the member was chosen; `reviewed` is what a person writes after deciding a `check`. */
export const ruleSchema = z.enum(['own-email', 'same-login', 'same-name', 'check', 'name-only', 'reviewed'])
export type Rule = z.infer<typeof ruleSchema>

/** A reviewed row: the member an account becomes, or `null` to write only its name. */
export const personSchema = z.object({
  accountId: z.string(),
  name: z.string(),
  email: z.string(),
  active: z.boolean(),
  occurrences: z.number(),
  member: z.email().nullable(),
  rule: ruleSchema
})
export type Person = z.infer<typeof personSchema>

const fold = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

const localPart = (email: string): string => email.split('@')[0] ?? ''

/** The domains whose people sign in to JiraIA (ADR-0005). */
const SIGN_IN_DOMAINS = [HOME_DOMAIN, 'lets.delivery']
const signsIn = (email: string): boolean => SIGN_IN_DOMAINS.includes(email.split('@')[1] ?? '')

/** The `uselets.com` member the same person already has: same login first, then same name. */
const homeMemberOf = (email: string, name: string, home: DirectoryEntry[]): { member: string; rule: Rule } | null => {
  const byLogin = email ? home.find((entry) => localPart(entry.email) === localPart(email)) : undefined
  if (byLogin) {
    return { member: byLogin.email, rule: 'same-login' }
  }
  const byName = home.find((entry) => fold(entry.name) === fold(name))
  return byName ? { member: byName.email, rule: 'same-name' } : null
}

/** The member an active account becomes, and why. */
const memberFor = (email: string, name: string, home: DirectoryEntry[]): { member: string; rule: Rule } => {
  if (signsIn(email)) {
    return { member: email, rule: 'own-email' }
  }
  return homeMemberOf(email, name, home) ?? { member: email, rule: 'check' }
}

/**
 * The proposal for every account. A deactivated account of someone still here joins their member;
 * whoever left, and every app, is written only by name; an active account with no e-mail anywhere is
 * `check`, never guessed.
 */
export const proposePeople = (accounts: Account[], directory: DirectoryEntry[]): Person[] => {
  const byId = new Map(directory.map((entry) => [entry.accountId, entry]))
  const home = directory.filter((entry) => entry.status === 'Active' && entry.email.endsWith(`@${HOME_DOMAIN}`))
  return accounts
    .map((account) => proposeOne(describe(account, byId.get(account.accountId)), account, home))
    .sort((a, b) => b.occurrences - a.occurrences)
}

type Described = Omit<Person, 'member' | 'rule'>

/** What the directory and the copy together say of an account. */
const describe = (account: Account, entry: DirectoryEntry | undefined): Described => ({
  accountId: account.accountId,
  name: account.name ?? entry?.name ?? account.accountId,
  email: entry?.email || account.email || '',
  active: entry?.status === 'Active' && account.accountType !== 'app' && account.active !== false,
  occurrences: account.occurrences
})

const proposeOne = (base: Described, account: Account, home: DirectoryEntry[]): Person => {
  if (!base.active) {
    const same = account.accountType === 'app' ? null : homeMemberOf(base.email, base.name, home)
    return same ? { ...base, ...same } : { ...base, member: null, rule: 'name-only' }
  }
  return base.email ? { ...base, ...memberFor(base.email, base.name, home) } : { ...base, member: null, rule: 'check' }
}

const COLUMNS = ['accountId', 'name', 'email', 'active', 'occurrences', 'member', 'rule'] as const

const quote = (cell: string): string => (/[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)

/** The proposal as the CSV a person reviews in a spreadsheet: `member` empty means only the name. */
export const peopleToCsv = (people: Person[]): string =>
  [
    COLUMNS.join(','),
    ...people.map((person) =>
      COLUMNS.map((column) => quote(column === 'member' ? (person.member ?? '') : String(person[column]))).join(',')
    )
  ].join('\n')

const reviewedRow = (cells: string[], line: number): Person => {
  const at = (column: (typeof COLUMNS)[number]) => cells[COLUMNS.indexOf(column)] ?? ''
  const person = personSchema.parse({
    accountId: at('accountId'),
    name: at('name'),
    email: at('email'),
    active: at('active') === 'true',
    occurrences: Number(at('occurrences')),
    member: at('member').trim().toLowerCase() || null,
    rule: at('rule')
  })
  if (person.rule === 'check') {
    throw new ValidationException(`Line ${line}: account "${person.name}" is still marked check`)
  }
  if (person.member && !signsIn(person.member)) {
    throw new ValidationException(`Line ${line}: member "${person.member}" cannot sign in to JiraIA`)
  }
  return person
}

/** The reviewed CSV back as people, refusing any row left undecided. */
export const peopleFromCsv = (csv: string): Person[] =>
  csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line, index) => reviewedRow(splitCsvLine(line), index + 2))

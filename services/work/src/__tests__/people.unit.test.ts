import { describe, expect, it } from 'bun:test'
import { ValidationException } from '@jiraia/core'
import { createLogger } from '@jiraia/logger'

import { InMemoryAtlassian } from '../import/atlassian-source.js'
import { InMemoryImportStore } from '../import/import-store.js'
import {
  collectAccounts,
  type DirectoryEntry,
  type Person,
  parseDirectory,
  peopleFromCsv,
  peopleToCsv,
  proposePeople
} from '../import/people.js'
import { PEOPLE_PROPOSAL, PeopleScan } from '../import/people-scan.js'

/**
 * Etapa 8b: every account the raw copy mentions becomes a member or only a name, and the accounts of
 * one person on several domains become one member (ADR-0036).
 */
const ANA = '712020:00000000-0000-4000-8000-00000000000a'
const ANA_OLD = '5f0000000000000000000a01'
const RUI = '712020:00000000-0000-4000-8000-00000000000b'
const GIL = '712020:00000000-0000-4000-8000-00000000000c'
const BOT = '557058:00000000-0000-4000-8000-0000000000ff'
const LEFT = '712020:00000000-0000-4000-8000-00000000000d'
const TEO_OLD = '5f0000000000000000000b01'
const DANI = '5f0000000000000000000e01'

const directory: DirectoryEntry[] = [
  { accountId: ANA, name: 'Ana Souza', email: 'ana.souza@uselets.com', status: 'Active' },
  { accountId: ANA_OLD, name: 'Ana Souza', email: 'ana.souza@parceiro.lets.delivery', status: 'Active' },
  { accountId: RUI, name: 'Rui Prado', email: 'rui@parceiro.lets.delivery', status: 'Active' },
  { accountId: GIL, name: 'Gil Matos', email: 'gil@parceiro.lets.delivery', status: 'Active' },
  { accountId: 'x', name: 'Gil Matos', email: 'gil.matos@uselets.com', status: 'Active' },
  { accountId: TEO_OLD, name: 'Téo Brandão', email: 'teo.brandao@parceiro.lets.delivery', status: 'Deactivated' },
  { accountId: 'y', name: 'Teo Brandao', email: 'teo.brandao@uselets.com', status: 'Active' },
  { accountId: DANI, name: 'Dani Reis', email: 'dani@lets.delivery', status: 'Active' }
]

const account = (accountId: string, name: string, extra: Partial<Person> = {}) => ({
  accountId,
  name,
  email: undefined,
  active: true,
  accountType: 'atlassian',
  occurrences: 1,
  ...extra
})

describe('collecting accounts', () => {
  it('finds Jira users, Confluence ids, changelog ids and @mentions, counting each', () => {
    const issue = {
      fields: {
        reporter: { accountId: ANA, displayName: 'Ana Souza', emailAddress: 'Ana.Souza@uselets.com', active: true },
        description: { type: 'doc', content: [{ type: 'mention', attrs: { id: RUI, text: '@Rui' } }] }
      },
      changelog: [{ author: { accountId: ANA, displayName: 'Ana Souza' }, items: [{ tmpToAccountId: GIL }] }]
    }
    const page = {
      node: {
        authorId: LEFT,
        body: { atlas_doc_format: { value: JSON.stringify({ type: 'mention', attrs: { id: RUI } }) } }
      }
    }
    const found = collectAccounts(page, collectAccounts(issue))

    expect(found.get(ANA)).toMatchObject({ name: 'Ana Souza', email: 'ana.souza@uselets.com', occurrences: 2 })
    expect(found.get(RUI)?.occurrences).toBe(2)
    expect([...found.keys()].sort()).toEqual([ANA, GIL, LEFT, RUI].sort())
  })
})

describe('proposing people', () => {
  const people = proposePeople(
    [
      account(ANA, 'Ana Souza'),
      account(ANA_OLD, 'Ana Souza'),
      account(GIL, 'Gil Matos'),
      account(RUI, 'Rui Prado'),
      account(LEFT, 'Lia Antiga', { active: false }),
      account(TEO_OLD, 'Téo Brandão', { active: false }),
      account(DANI, 'Dani Reis'),
      account(BOT, 'Automation for Jira', { accountType: 'app' } as Partial<Person>)
    ],
    directory
  )
  const of = (id: string) => people.find((person) => person.accountId === id)

  it('keeps a uselets.com address and joins the same login on another domain to it', () => {
    expect(of(ANA)).toMatchObject({ member: 'ana.souza@uselets.com', rule: 'own-email' })
    expect(of(ANA_OLD)).toMatchObject({ member: 'ana.souza@uselets.com', rule: 'same-login' })
  })

  it('joins by the same name when the login differs, and asks about the rest', () => {
    expect(of(GIL)).toMatchObject({ member: 'gil.matos@uselets.com', rule: 'same-name' })
    expect(of(RUI)).toMatchObject({ member: 'rui@parceiro.lets.delivery', rule: 'check' })
  })

  it('signs in a lets.delivery address as it is, and joins a deactivated account to its person', () => {
    expect(of(DANI)).toMatchObject({ member: 'dani@lets.delivery', rule: 'own-email' })
    expect(of(TEO_OLD)).toMatchObject({ member: 'teo.brandao@uselets.com', rule: 'same-login', active: false })
  })

  it('writes only the name of whoever left and of apps', () => {
    expect(of(LEFT)).toMatchObject({ member: null, rule: 'name-only', active: false })
    expect(of(BOT)).toMatchObject({ member: null, rule: 'name-only' })
  })
})

describe('the review CSV', () => {
  const rows: Person[] = [
    {
      accountId: ANA,
      name: 'Souza, Ana',
      email: 'ana.souza@uselets.com',
      active: true,
      occurrences: 9,
      member: 'ana.souza@uselets.com',
      rule: 'own-email'
    },
    { accountId: LEFT, name: 'Lia Antiga', email: '', active: false, occurrences: 2, member: null, rule: 'name-only' }
  ]

  it('comes back as it went, with an empty member meaning only the name', () => {
    expect(peopleFromCsv(peopleToCsv(rows))).toEqual(rows)
  })

  it('refuses a row still marked check, and a member who cannot sign in', () => {
    const check = peopleToCsv([{ ...rows[0], rule: 'check' } as Person])
    const foreign = peopleToCsv([{ ...rows[0], member: 'ana@gmail.com', rule: 'reviewed' } as Person])

    expect(() => peopleFromCsv(check)).toThrow(ValidationException)
    expect(() => peopleFromCsv(foreign)).toThrow('Line 2: member "ana@gmail.com" cannot sign in to JiraIA')
  })

  it('reads the admin export by its header names', () => {
    const csv = 'User id,User name,email,User status,Added to org\nid-1,"Souza, Ana",ANA@USELETS.COM,Active,1 Jan 2026'
    expect(parseDirectory(csv)).toEqual([
      { accountId: 'id-1', name: 'Souza, Ana', email: 'ana@uselets.com', status: 'Active' }
    ])
  })
})

describe('the people scan', () => {
  it('names the accounts Confluence only gives an id for, from Jira’s user API, and joins them to their person', async () => {
    const store = new InMemoryImportStore()
    await store.putJson('import/j1/jira/manifest.json', { run: 'j1', issues: {} })
    await store.putJson('import/c1/confluence/spaces.json', [{ key: 'CS' }])
    await store.putJson('import/c1/confluence/CS/tree.json', [{ id: 'p1', type: 'page', parentId: null }])
    await store.putJson('import/c1/confluence/CS/pages/p1.json', { node: { authorId: GIL }, versions: [] })
    await store.putBytes(
      'backups/users.csv',
      new TextEncoder().encode('User id,User name,email,User status\nx,Gil Matos,gil.matos@uselets.com,Active')
    )
    const source = new InMemoryAtlassian({
      projects: [],
      issues: [],
      users: [{ accountId: GIL, displayName: 'Gil Matos', active: true }]
    })

    const people = await new PeopleScan({ source, store, logger: createLogger('work', 'import') }).run({
      jiraRun: 'j1',
      confluenceRun: 'c1',
      directoryKey: 'backups/users.csv'
    })

    expect(people).toEqual([
      {
        accountId: GIL,
        name: 'Gil Matos',
        email: '',
        active: false,
        occurrences: 1,
        member: 'gil.matos@uselets.com',
        rule: 'same-name'
      }
    ])
    expect(store.documents.get(PEOPLE_PROPOSAL)).toEqual(people)
  })
})

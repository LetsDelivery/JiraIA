import type { IdGenerator } from '@jiraia/core'
import type { Database } from '@jiraia/db'

import { members } from '../schema.js'
import type { ImportRepository, RefRow } from './import.repository.js'
import type { Account, Person } from './people.js'

export type MemberInsert = typeof members.$inferInsert

/** Who an Atlassian account is in JiraIA: always a member, inactive for whoever left (ADR-0036). */
export type People = {
  memberOf(accountId: string): string | undefined
  /** Accounts the raw copy mentions that the reviewed mapping did not list; imported as inactive. */
  unmapped: string[]
}

type Deps = { db: Database; repository: ImportRepository; ids: IdGenerator }
type Input = { organizationId: string; run: string; at: Date; mapping: Person[]; seen: Account[] }

const personRow = (
  input: Input,
  id: string,
  person: { name: string; email: string | null; active: boolean }
): MemberInsert => ({
  id,
  organizationId: input.organizationId,
  kind: 'person',
  subject: null,
  email: person.email,
  name: person.name.slice(0, 120),
  status: person.active ? 'active' : 'inactive',
  createdAt: input.at,
  deactivatedAt: person.active ? null : input.at
})

/**
 * Etapa 8c: every account of the reviewed mapping (8b) becomes a member. One already in JiraIA is
 * found by e-mail; one who never signed in is invited (active, no subject yet); whoever left — and
 * every app — becomes an inactive member with no e-mail, under the name Atlassian gave them.
 */
export class ImportMembers {
  constructor(private readonly deps: Deps) {}

  async ensure(input: Input): Promise<People> {
    const known = await this.deps.repository.refs(input.organizationId, 'atlassian', 'account')
    const byEmail = await this.deps.repository.membersByEmail(input.organizationId)
    const resolved = new Map([...known].map(([accountId, ref]) => [accountId, ref.targetId]))
    const inserts: MemberInsert[] = []
    const refs: RefRow[] = []
    const remember = (accountId: string, memberId: string) => {
      resolved.set(accountId, memberId)
      refs.push({
        organizationId: input.organizationId,
        source: 'atlassian',
        entity: 'account',
        sourceId: accountId,
        targetId: memberId,
        contentHash: '',
        runId: input.run,
        importedAt: input.at
      })
    }
    for (const person of input.mapping.filter((row) => !resolved.has(row.accountId))) {
      remember(person.accountId, this.memberFor(input, person, byEmail, inserts))
    }
    const mapped = new Set(input.mapping.map((row) => row.accountId))
    const unmapped = input.seen.filter((account) => !mapped.has(account.accountId))
    for (const account of unmapped.filter((row) => !resolved.has(row.accountId))) {
      const id = this.deps.ids.next()
      inserts.push(personRow(input, id, { name: account.name ?? account.accountId, email: null, active: false }))
      remember(account.accountId, id)
    }
    await this.write(inserts, refs)
    return { memberOf: (accountId) => resolved.get(accountId), unmapped: unmapped.map((row) => row.accountId) }
  }

  /** The member a reviewed row names, found by e-mail or invited; a name-only row is a new inactive member. */
  private memberFor(input: Input, person: Person, byEmail: Map<string, string>, inserts: MemberInsert[]): string {
    const existing = person.member ? byEmail.get(person.member) : undefined
    if (existing) {
      return existing
    }
    const id = this.deps.ids.next()
    inserts.push(personRow(input, id, { name: person.name, email: person.member, active: person.member !== null }))
    if (person.member) {
      byEmail.set(person.member, id)
    }
    return id
  }

  private async write(inserts: MemberInsert[], refs: RefRow[]): Promise<void> {
    await this.deps.db.transaction(async (tx) => {
      if (inserts.length > 0) {
        await tx.insert(members).values(inserts)
      }
      await this.deps.repository.putRefs(tx, refs)
    })
  }
}

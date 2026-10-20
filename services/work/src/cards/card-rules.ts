import { ConflictException, NotFoundException, ValidationException } from '@jiraia/core'

import type { Changes } from '../audit/audit.js'
import type { GroupRepository } from '../groups/group.repository.js'
import type { MemberRepository } from '../members/member.repository.js'
import type { MemberRow } from '../members/schemas.js'
import type { CardRepository } from './card.repository.js'
import type { FieldRepository } from './field.repository.js'
import { type FieldView, parseFieldValue, toFieldView } from './field.schemas.js'
import type { CardRow } from './schemas.js'
import type { WorkflowRepository } from './workflow.repository.js'

type Deps = {
  cards: CardRepository
  fields: FieldRepository
  groups: GroupRepository
  members: MemberRepository
  workflows: WorkflowRepository
}

/** What a card's values must respect before any of them is written: they belong to its space. */
export class CardRules {
  constructor(private readonly deps: Deps) {}

  /** The type and state a card goes to: the ones named, which must be the space's, or the first of each. */
  async placement(spaceId: string, typeId?: string, stateId?: string) {
    const [states, types] = await Promise.all([this.deps.workflows.states(spaceId), this.deps.workflows.types(spaceId)])
    const state = stateId ? states.find((each) => each.id === stateId) : states[0]
    const type = typeId ? types.find((each) => each.id === typeId) : types[0]
    if (!state || !type) {
      throw new ValidationException('The state or the type is not one of this space', { spaceId, stateId, typeId })
    }
    return { stateId: state.id, typeId: type.id }
  }

  async activeMember(actor: MemberRow, memberId: string): Promise<void> {
    const member = await this.deps.members.findById(actor.organizationId, memberId)
    if (member?.status !== 'active') {
      throw new NotFoundException('Active member', memberId)
    }
  }

  /** A card's group is one of the organization's, not deleted. */
  async activeGroup(actor: MemberRow, groupId: string): Promise<void> {
    if (!(await this.deps.groups.find(actor.organizationId, groupId))) {
      throw new NotFoundException('Group', groupId)
    }
  }

  /**
   * A parent is a card of the same space, and never the card itself or one of its own descendants —
   * the hierarchy Epic → História → Subtarefa is a tree (2.6).
   */
  async assertParent(actor: MemberRow, spaceId: string, parentId: string, cardId?: string): Promise<void> {
    let current = await this.deps.cards.find(actor.organizationId, parentId)
    if (current?.spaceId !== spaceId) {
      throw new ValidationException(`Parent "${parentId}" is not a card of this space`, { parentId })
    }
    for (let depth = 0; current && depth < 50; depth += 1) {
      if (current.id === cardId) {
        throw new ConflictException(`Card "${parentId}" is below this card; it cannot be its parent`, { parentId })
      }
      current = current.parentId ? await this.deps.cards.find(actor.organizationId, current.parentId) : undefined
    }
  }

  /**
   * The card's custom field values after `input`: each one checked against its field's kind, its
   * options and the types it shows on (2.5). `null` clears a value.
   */
  async customFields(
    actor: MemberRow,
    card: Pick<CardRow, 'spaceId' | 'typeId' | 'customFields'>,
    input: Record<string, unknown>
  ) {
    const fields = (await this.deps.fields.list(card.spaceId)).map(toFieldView)
    const next: Record<string, unknown> = { ...(card.customFields as Record<string, unknown>) }
    for (const [id, value] of Object.entries(input)) {
      next[id] = await this._value(
        actor,
        fields.find((each) => each.id === id && _showsOn(each, card.typeId)),
        id,
        value
      )
    }
    return Object.fromEntries(Object.entries(next).filter(([, value]) => value !== null))
  }

  private async _value(actor: MemberRow, field: FieldView | undefined, id: string, value: unknown) {
    if (!field) {
      throw new ValidationException(`Field "${id}" is not a field of this card's type`, { fieldId: id })
    }
    const parsed = parseFieldValue(field, value)
    if (field.kind === 'person' && parsed !== null) {
      await this.activeMember(actor, parsed as string)
    }
    return parsed
  }
}

/** An empty `typeIds` shows the field on every type of the space. */
const _showsOn = (field: FieldView, typeId: string): boolean =>
  field.typeIds.length === 0 || field.typeIds.includes(typeId)

/**
 * Field-by-field changes of the custom values, as `field:<id>` lines of the card's history.
 *
 * @example fieldChanges({ a: 1 }, { a: 2 })   // { 'field:a': { before: 1, after: 2 } }
 */
export const fieldChanges = (before: Record<string, unknown>, after: Record<string, unknown>): Changes => {
  const changes: Changes = {}
  for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[id]) !== JSON.stringify(after[id])) {
      changes[`field:${id}`] = { before: before[id] ?? null, after: after[id] ?? null }
    }
  }
  return changes
}

import type { Caller } from '@jiraia/http'

import type { CardService } from '../cards/card.service.js'
import type { CommentService } from '../cards/comment.service.js'
import type { CardRef } from '../cards/link.schemas.js'
import type { LinkService } from '../cards/link.service.js'
import type { CardView } from '../cards/schemas.js'
import type { SlackService } from '../integrations/slack.service.js'
import type { Action, RunStep } from './schemas.js'
import { fill, type TemplateValues } from './template.js'

type Deps = {
  cards: CardService
  links: LinkService
  comments: CommentService
  slack: SlackService
  /** The panel's address, for `{{card.url}}`. */
  webUrl: string
}

type Run = { caller: Caller; organizationId: string; card: CardView; values: TemplateValues }

/**
 * Does what a rule says, through the same services a person goes through — so every change is
 * checked, audited and shown in history like any other, under the "Automação" member.
 */
export class ActionRunner {
  constructor(private readonly deps: Deps) {}

  async run(actions: readonly Action[], card: CardView, context: { caller: Caller; organizationId: string }) {
    const run: Run = { ...context, card, values: { card: this.values(card) } }
    const steps: RunStep[] = []
    for (const action of actions) {
      steps.push(...(await this._one(action, run)))
    }
    return steps
  }

  /** What a template can say about a card. */
  values(card: Pick<CardView, 'key' | 'title'> & { description?: string }): Record<string, string> {
    const spaceKey = card.key.split('-')[0] ?? ''
    return {
      key: card.key,
      title: card.title,
      description: card.description ?? '',
      url: `${this.deps.webUrl}/espacos/${spaceKey}?card=${card.key}`
    }
  }

  private async _one(action: Action, run: Run): Promise<RunStep[]> {
    if (action.type === 'create_card') {
      return [await this._create(action, run)]
    }
    if (action.type === 'move_linked') {
      return await this._moveLinked(action, run)
    }
    if (action.type === 'set_state') {
      await this.deps.cards.update(run.caller, run.card.id, { stateId: action.stateId })
      return [{ action: action.type, detail: run.card.key }]
    }
    if (action.type === 'comment') {
      await this.deps.comments.create(run.caller, run.card.id, fill(action.body, run.values))
      return [{ action: action.type, detail: run.card.key }]
    }
    await this.deps.slack.post(run.organizationId, action.channelId, fill(action.text, run.values))
    return [{ action: action.type, detail: action.channelId }]
  }

  private async _create(action: Extract<Action, { type: 'create_card' }>, run: Run): Promise<RunStep> {
    const title = fill(action.title, run.values).trim().slice(0, 255) || run.card.title
    const created = await this.deps.cards.create(run.caller, action.spaceId, {
      title,
      description: fill(action.description, run.values),
      priority: 'medium',
      labels: [],
      ...(action.typeId ? { typeId: action.typeId } : {}),
      ...(action.stateId ? { stateId: action.stateId } : {})
    })
    if (action.link) {
      await this.deps.links.link(run.caller, run.card.id, { ...action.link, cardId: created.id })
    }
    run.values.created = this.values(created)
    return { action: action.type, detail: created.key }
  }

  /** The cards tied to this one by the link, in the named space, go to the state — each once. */
  private async _moveLinked(action: Extract<Action, { type: 'move_linked' }>, run: Run): Promise<RunStep[]> {
    const relations = await this.deps.links.relations(run.caller, run.card.id)
    const targets = relations.links
      .filter((link) => link.type === action.linkType && link.direction === action.direction)
      .map((link) => link.card)
      .filter((card) => card.spaceId === action.spaceId)
    const steps: RunStep[] = []
    for (const target of targets) {
      steps.push(await this._moveOne(target, action, run))
    }
    return steps.length > 0 ? steps : [{ action: action.type, detail: '' }]
  }

  private async _moveOne(
    target: CardRef,
    action: Extract<Action, { type: 'move_linked' }>,
    run: Run
  ): Promise<RunStep> {
    await this.deps.cards.update(run.caller, target.id, { stateId: action.stateId })
    if (action.comment.trim()) {
      const values = { ...run.values, linked: this.values(target) }
      await this.deps.comments.create(run.caller, target.id, fill(action.comment, values))
    }
    return { action: action.type, detail: target.key }
  }
}

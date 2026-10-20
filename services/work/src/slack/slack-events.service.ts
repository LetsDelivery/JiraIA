import { createHmac, timingSafeEqual } from 'node:crypto'

import type { Clock } from '@jiraia/core'

import type { CardRepository } from '../cards/card.repository.js'
import type { WorkflowRepository } from '../cards/workflow.repository.js'
import { keyInUrl, keysInText } from './card-keys.js'
import type { SlackSecrets } from './secrets.js'
import type { SlackRepository, WorkspaceRow } from './slack.repository.js'
import type { Block, SlackApi } from './slack-api.js'
import { cardPreview } from './slack-copy.js'

/** A request from Slack as it arrived: the raw body (the signature is over it) and the headers. */
export type SlackRequest = { body: string; headers: Record<string, string | undefined> }
export type SlackReply = { statusCode: number; body: string }

type Deps = {
  clock: Clock
  slack: SlackRepository
  cards: CardRepository
  workflows: WorkflowRepository
  api: SlackApi
  secrets: SlackSecrets | undefined
  signingSecret: string | undefined
  webUrl: string
}

type Event = {
  type?: string
  channel?: string
  ts?: string
  thread_ts?: string
  text?: string
  subtype?: string
  bot_id?: string
  links?: { url: string }[]
}

/** Slack's requests older than this are refused, so a captured one cannot be replayed. */
const MAX_AGE_S = 300
/** At most this many cards previewed for the keys of one message. */
const KEYS_PER_MESSAGE = 3

const ok: SlackReply = { statusCode: 200, body: '' }

/**
 * What Slack tells JiraIA (Etapa 5e, ADR-0018): a JiraIA link shared in a channel gets the card's
 * preview, and a card key written in a message gets it as a reply in the thread. Every request is
 * checked against the signing secret first; one that fails is refused.
 */
export class SlackEventsService {
  constructor(private readonly deps: Deps) {}

  /** Slack's signature: `v0=` and the HMAC-SHA256 of `v0:<timestamp>:<body>` with the signing secret. */
  private genuine(request: SlackRequest): boolean {
    const timestamp = Number(request.headers['x-slack-request-timestamp'])
    const signature = request.headers['x-slack-signature'] ?? ''
    const fresh = Math.abs(this.deps.clock.now().getTime() / 1000 - timestamp) <= MAX_AGE_S
    if (!this.deps.signingSecret || !fresh) {
      return false
    }
    const expected = `v0=${createHmac('sha256', this.deps.signingSecret).update(`v0:${timestamp}:${request.body}`).digest('hex')}`
    return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  }

  async handle(request: SlackRequest): Promise<SlackReply> {
    if (!this.genuine(request)) {
      return { statusCode: 401, body: 'invalid signature' }
    }
    const payload = JSON.parse(request.body) as { type?: string; challenge?: string; team_id?: string; event?: Event }
    if (payload.type === 'url_verification') {
      return { statusCode: 200, body: JSON.stringify({ challenge: payload.challenge }) }
    }
    // A retry means Slack did not hear back in time; the first delivery is being handled already.
    if (request.headers['x-slack-retry-num'] || payload.type !== 'event_callback' || !payload.event) {
      return ok
    }
    const workspace = await this.deps.slack.byTeam(payload.team_id ?? '')
    if (workspace && this.deps.secrets) {
      await this.onEvent(workspace, this.deps.secrets.open(workspace.botToken), payload.event)
    }
    return ok
  }

  private async onEvent(workspace: WorkspaceRow, token: string, event: Event): Promise<void> {
    if (event.type === 'link_shared') {
      await this.unfurl(workspace, token, event)
    } else if (event.type === 'message' && !event.subtype && !event.bot_id) {
      await this.reply(workspace, token, event)
    }
  }

  private async unfurl(workspace: WorkspaceRow, token: string, event: Event): Promise<void> {
    const unfurls: Record<string, { blocks: Block[] }> = {}
    for (const { url } of event.links ?? []) {
      const key = keyInUrl(url, this.deps.webUrl)
      const blocks = key ? await this.preview(workspace.organizationId, key) : undefined
      if (blocks) {
        unfurls[url] = { blocks }
      }
    }
    if (Object.keys(unfurls).length && event.channel && event.ts) {
      await this.deps.api.unfurl(token, event.channel, event.ts, unfurls)
    }
  }

  /** Keys written in a message: their previews, in one reply in the message's thread. */
  private async reply(workspace: WorkspaceRow, token: string, event: Event): Promise<void> {
    const previews = await Promise.all(
      keysInText(event.text ?? '', KEYS_PER_MESSAGE).map((key) => this.preview(workspace.organizationId, key))
    )
    const blocks = previews.flatMap((each) => each ?? [])
    if (blocks.length && event.channel && event.ts) {
      await this.deps.api.post(token, {
        channel: event.channel,
        threadTs: event.thread_ts ?? event.ts,
        text: 'Cards do JiraIA',
        blocks
      })
    }
  }

  /** A card's preview, or nothing for a key no card has. Everyone at Let’s reads every card (ADR-0012). */
  private async preview(organizationId: string, key: string): Promise<Block[] | undefined> {
    const card = await this.deps.cards.findByKey(organizationId, key)
    if (!card) {
      return undefined
    }
    const [state, types] = await Promise.all([
      this.deps.workflows.findState(card.spaceId, card.stateId),
      this.deps.workflows.types(card.spaceId)
    ])
    const typeName = types.find((type) => type.id === card.typeId)?.name ?? ''
    return cardPreview(
      { card, typeName, stateName: state?.name ?? '', stateGroup: state?.group ?? '' },
      this.deps.webUrl
    )
  }
}

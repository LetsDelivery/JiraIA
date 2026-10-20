import { type Clock, UnauthenticatedException } from '@jiraia/core'
import type { Caller } from '@jiraia/http'
import { z } from 'zod'

import type { Broadcaster } from './broadcaster.js'
import { yjsBase64Schema } from './content.schemas.js'
import type { DocumentService } from './document.service.js'
import type { DrawGate } from './draw-gate.js'
import type { RealtimeRepository } from './realtime.repository.js'

type Deps = {
  clock: Clock
  drawGate: DrawGate
  realtime: RealtimeRepository
  documents: DocumentService
  broadcaster: Broadcaster
  /** Where browsers open the WebSocket: `wss://…` in AWS, `ws://localhost…/realtime` locally. */
  url: string
}

const TICKET_MS = 60_000

/**
 * What a browser sends on the page's WebSocket: a change to the document, which is stored and passed
 * on, or its awareness — cursor, selection, name — which is only passed on (ADR-0009).
 */
export const realtimeMessageSchema = z.object({
  type: z.enum(['update', 'awareness']),
  update: yjsBase64Schema.min(1)
})

const _token = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url')

/** Editing a page together (escopo-mvp 5.3): tickets, connections, and relaying what each one sends. */
export class RealtimeService {
  constructor(private readonly deps: Deps) {}

  /** A one-use pass for the WebSocket, issued behind the HTTP API's Google authorizer. */
  async ticket(caller: Caller, contentId: string) {
    const { gate, content } = await this.deps.drawGate.openDocument(caller, contentId, 'read')
    const now = this.deps.clock.now()
    const expiresAt = new Date(now.getTime() + TICKET_MS)
    const token = _token()
    await this.deps.realtime.dropExpired(now)
    await this.deps.realtime.issue({
      token,
      contentId: content.id,
      memberId: gate.actor.id,
      canWrite: gate.canWrite,
      expiresAt
    })
    return { url: this.deps.url, ticket: token, expiresAt: expiresAt.toISOString() }
  }

  async connect(connectionId: string, token: string | undefined): Promise<void> {
    const ticket = token ? await this.deps.realtime.redeem(token, this.deps.clock.now()) : undefined
    if (!ticket) {
      throw new UnauthenticatedException('The realtime ticket is missing, used or expired')
    }
    await this.deps.realtime.connect({
      connectionId,
      contentId: ticket.contentId,
      memberId: ticket.memberId,
      canWrite: ticket.canWrite,
      connectedAt: this.deps.clock.now()
    })
  }

  async disconnect(connectionId: string): Promise<void> {
    await this.deps.realtime.disconnect(connectionId)
  }

  /** A change from someone who may not write is dropped; anything else reaches the page's others. */
  async receive(connectionId: string, body: string): Promise<void> {
    const connection = await this.deps.realtime.connection(connectionId)
    const message = realtimeMessageSchema.safeParse(_json(body))
    if (!connection || !message.success) {
      return
    }
    if (message.data.type === 'update') {
      if (!connection.canWrite) {
        return
      }
      await this.deps.documents.apply(connection.contentId, connection.memberId, message.data.update)
    }
    await this._relay(connection.contentId, connectionId, JSON.stringify(message.data))
  }

  /**
   * A change sent over HTTP — too large for one WebSocket message — is stored, and the page's
   * connections are told to load the page again rather than handed the change itself.
   */
  async pushFromHttp(caller: Caller, contentId: string, update: string): Promise<{ state: string }> {
    const result = await this.deps.documents.applyFromCaller(caller, contentId, update)
    await this._relay(contentId, '', JSON.stringify({ type: 'reload' }))
    return result
  }

  private async _relay(contentId: string, from: string, message: string): Promise<void> {
    const others = await this.deps.realtime.others(contentId, from)
    const results = await Promise.all(others.map((each) => this.deps.broadcaster.send(each.connectionId, message)))
    const gone = others.filter((_, index) => results[index] === 'gone')
    await Promise.all(gone.map((each) => this.deps.realtime.disconnect(each.connectionId)))
  }
}

const _json = (body: string): unknown => {
  try {
    return JSON.parse(body)
  } catch {
    return undefined
  }
}

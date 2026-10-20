import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import * as Y from 'yjs'

import { drawRead, drawWrite } from '@/api/draw'
import { fromBase64, toBase64 } from '@/lib/base64'

export type ProviderStatus = 'connecting' | 'online' | 'offline'

/** Below API Gateway's 128 KB per message, with room for the JSON around the update. */
const MAX_SOCKET_BYTES = 96_000
const RETRY_MS = [1000, 2000, 5000, 10_000]

type Message = { type: 'update' | 'awareness'; update: string } | { type: 'reload' }

/**
 * A page's or whiteboard's Y.Doc, kept in step with everyone else's (ADR-0009). The state is loaded over HTTP; each
 * local change goes out on the realtime WebSocket and each remote one comes in. A change made while
 * the socket is down waits, and the page is loaded again when it comes back, so nothing is lost.
 */
export class ContentProvider {
  readonly awareness: Awareness
  private socket: WebSocket | undefined
  private pending: Uint8Array[] = []
  private attempt = 0
  private stopped = false

  constructor(
    private readonly options: {
      contentId: string
      doc: Y.Doc
      canWrite: boolean
      onStatus: (status: ProviderStatus) => void
    }
  ) {
    this.awareness = new Awareness(options.doc)
    options.doc.on('update', this.onDocUpdate)
    this.awareness.on('update', this.onAwarenessUpdate)
  }

  /** Loads the page, then connects; resolves once the content is there, online or not. */
  async start(): Promise<void> {
    await this.load()
    void this.connect()
  }

  destroy(): void {
    this.stopped = true
    removeAwarenessStates(this.awareness, [this.options.doc.clientID], 'local')
    this.socket?.close()
    this.options.doc.off('update', this.onDocUpdate)
    this.awareness.off('update', this.onAwarenessUpdate)
    this.awareness.destroy()
  }

  private async load(): Promise<void> {
    const { state } = await drawRead.document(this.options.contentId)
    if (state) {
      Y.applyUpdate(this.options.doc, fromBase64(state), this)
    }
  }

  private async connect(): Promise<void> {
    this.options.onStatus('connecting')
    const ticket = await drawRead.realtimeTicket(this.options.contentId).catch(() => undefined)
    if (!ticket || this.stopped) {
      this.retryLater()
      return
    }
    const socket = new WebSocket(`${ticket.url}?ticket=${encodeURIComponent(ticket.ticket)}`)
    this.socket = socket
    socket.addEventListener('open', () => void this.onOpen())
    socket.addEventListener('message', (event) => this.onMessage(String(event.data)))
    socket.addEventListener('close', () => this.retryLater())
  }

  private async onOpen(): Promise<void> {
    this.attempt = 0
    this.options.onStatus('online')
    await this.load()
    if (this.pending.length > 0) {
      this.sendUpdate(Y.mergeUpdates(this.pending.splice(0)))
    }
    const self = [this.options.doc.clientID]
    this.send({ type: 'awareness', update: toBase64(encodeAwarenessUpdate(this.awareness, self)) })
  }

  private retryLater(): void {
    if (this.stopped) {
      return
    }
    this.socket = undefined
    this.options.onStatus('offline')
    const wait = RETRY_MS[Math.min(this.attempt, RETRY_MS.length - 1)]
    this.attempt += 1
    setTimeout(() => void this.connect(), wait)
  }

  /** A `reload` means a change too large to pass on arrived over HTTP: the page is read again. */
  private onMessage(data: string): void {
    const message = JSON.parse(data) as Message
    if (message.type === 'reload') {
      void this.load()
    } else if (message.type === 'update') {
      Y.applyUpdate(this.options.doc, fromBase64(message.update), this)
    } else {
      applyAwarenessUpdate(this.awareness, fromBase64(message.update), this)
    }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this || !this.options.canWrite) {
      return
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendUpdate(update)
    } else {
      this.pending.push(update)
    }
  }

  private readonly onAwarenessUpdate = (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown
  ): void => {
    if (origin === this) {
      return
    }
    const clients = [...changes.added, ...changes.updated, ...changes.removed]
    this.send({ type: 'awareness', update: toBase64(encodeAwarenessUpdate(this.awareness, clients)) })
  }

  private sendUpdate(update: Uint8Array): void {
    const encoded = toBase64(update)
    if (encoded.length > MAX_SOCKET_BYTES) {
      void drawWrite.pushUpdate(this.options.contentId, encoded).catch(() => this.pending.push(update))
      return
    }
    this.send({ type: 'update', update: encoded })
  }

  private send(message: Extract<Message, { update: string }>): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message))
    }
  }
}

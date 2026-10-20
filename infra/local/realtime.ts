import { createLogger } from '@jiraia/logger'
import type { Server, ServerWebSocket } from 'bun'

import type { Broadcaster } from '../../services/work/src/draw/broadcaster.js'
import type { RealtimeService } from '../../services/work/src/draw/realtime.service.js'
import { handleRealtime, type WebsocketEvent } from '../../services/work/src/draw/realtime-handler.js'

/**
 * The WebSocket API, on the harness's own port (`/realtime?ticket=…`): Bun's WebSockets play API
 * Gateway, and each event runs the **real** realtime handler — `$connect`, `$default`, `$disconnect` —
 * as in AWS (ADR-0009). The third stand-in of the harness, after Google and S3.
 */
export type SocketData = { connectionId: string; ticket: string | undefined }

/** Sends to the sockets this process holds open — what `PostToConnection` does in AWS. */
export class LocalBroadcaster implements Broadcaster {
  readonly sockets = new Map<string, ServerWebSocket<SocketData>>()

  async send(connectionId: string, message: string): Promise<'sent' | 'gone'> {
    const socket = this.sockets.get(connectionId)
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return 'gone'
    }
    socket.send(message)
    return 'sent'
  }
}

const _event = (routeKey: string, data: SocketData, body?: string): WebsocketEvent =>
  ({
    requestContext: { routeKey, connectionId: data.connectionId },
    queryStringParameters: data.ticket ? { ticket: data.ticket } : null,
    ...(body === undefined ? {} : { body }),
    isBase64Encoded: false
  }) as unknown as WebsocketEvent

/** Upgrades `/realtime` requests; anything else is not this module's. */
export const upgrade = (request: Request, server: Server<SocketData>): boolean => {
  const url = new URL(request.url)
  const data = { connectionId: crypto.randomUUID(), ticket: url.searchParams.get('ticket') ?? undefined }
  return url.pathname === '/realtime' && server.upgrade(request, { data })
}

/** The socket handlers Bun calls, wired to the realtime handler and the local broadcaster. */
export const realtimeSockets = (realtime: RealtimeService, broadcaster: LocalBroadcaster) => {
  const logger = createLogger('local', 'realtime')
  return {
    open: async (socket: ServerWebSocket<SocketData>) => {
      broadcaster.sockets.set(socket.data.connectionId, socket)
      const result = await handleRealtime(realtime, logger, _event('$connect', socket.data))
      if (typeof result === 'object' && result.statusCode !== 200) {
        socket.close(4000 + (result.statusCode ?? 500), 'refused')
      }
    },
    message: async (socket: ServerWebSocket<SocketData>, message: string | Buffer) => {
      await handleRealtime(realtime, logger, _event('$default', socket.data, String(message)))
    },
    close: async (socket: ServerWebSocket<SocketData>) => {
      broadcaster.sockets.delete(socket.data.connectionId)
      await handleRealtime(realtime, logger, _event('$disconnect', socket.data))
    }
  }
}

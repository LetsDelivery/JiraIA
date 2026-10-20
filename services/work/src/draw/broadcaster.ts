import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand
} from '@aws-sdk/client-apigatewaymanagementapi'

/** Sends a message to one open WebSocket; `gone` when the browser is no longer there (ADR-0009). */
export type Broadcaster = { send: (connectionId: string, message: string) => Promise<'sent' | 'gone'> }

/**
 * The WebSocket API's management endpoint: `wss://…/dev` is reached as `https://…/dev`.
 *
 * @example managementEndpoint('wss://abc.execute-api.us-east-1.amazonaws.com/dev')   // 'https://abc.execute-api.us-east-1.amazonaws.com/dev'
 */
export const managementEndpoint = (url: string): string => url.replace(/^wss:/, 'https:')

/** Through API Gateway, as the deployed realtime Lambda posts to its connections. */
export class ApiGatewayBroadcaster implements Broadcaster {
  private readonly client: ApiGatewayManagementApiClient

  constructor(options: { url: string; region: string }) {
    this.client = new ApiGatewayManagementApiClient({
      endpoint: managementEndpoint(options.url),
      region: options.region
    })
  }

  async send(connectionId: string, message: string): Promise<'sent' | 'gone'> {
    try {
      await this.client.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: message }))
      return 'sent'
    } catch (error) {
      if (error instanceof GoneException) {
        return 'gone'
      }
      throw error
    }
  }
}

/** Remembers what it was asked to send — the integration suite's stand-in for API Gateway. */
export class RecordingBroadcaster implements Broadcaster {
  readonly sent: { connectionId: string; message: unknown }[] = []
  readonly gone = new Set<string>()

  async send(connectionId: string, message: string): Promise<'sent' | 'gone'> {
    if (this.gone.has(connectionId)) {
      return 'gone'
    }
    this.sent.push({ connectionId, message: JSON.parse(message) })
    return 'sent'
  }
}

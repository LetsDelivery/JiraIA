import { DependencyUnavailableException } from '@jiraia/core'
import type { HttpClient } from '@jiraia/http'

/**
 * What JiraIA asks of Slack's Web API (Etapa 5e, ADR-0018). The service owns this type; `HttpSlackApi`
 * is the real one, and the suites reach it through MSW.
 */
export type Installed = { teamId: string; teamName: string; botUserId: string; token: string }
export type Block = Record<string, unknown>

export type SlackApi = {
  exchange(code: string, redirectUri: string): Promise<Installed>
  userByEmail(token: string, email: string): Promise<string | null>
  post(token: string, message: { channel: string; text: string; blocks?: Block[]; threadTs?: string }): Promise<void>
  unfurl(token: string, channel: string, ts: string, unfurls: Record<string, { blocks: Block[] }>): Promise<void>
}

type Answer = Record<string, unknown> & { ok?: boolean; error?: string }

export class HttpSlackApi implements SlackApi {
  constructor(
    private readonly http: HttpClient,
    private readonly options: { apiUrl: string; clientId?: string | undefined; clientSecret?: string | undefined }
  ) {}

  /** Slack answers 200 with `ok: false` for its own refusals; both kinds become one exception. */
  private async call(method: string, body: Record<string, unknown>, token?: string): Promise<Answer> {
    const response = await this.http.send({
      method: 'POST',
      url: `${this.options.apiUrl}/${method}`,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    })
    const answer = (response.status === 200 ? JSON.parse(response.body) : {}) as Answer
    if (!answer.ok) {
      throw new DependencyUnavailableException(
        'Slack',
        `${method} answered ${response.status} ${answer.error ?? ''}`.trim()
      )
    }
    return answer
  }

  /** `oauth.v2.access` takes the client's id and secret as form fields, not JSON. */
  async exchange(code: string, redirectUri: string): Promise<Installed> {
    const form = new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      client_id: this.options.clientId ?? '',
      client_secret: this.options.clientSecret ?? ''
    })
    const response = await this.http.send({
      method: 'POST',
      url: `${this.options.apiUrl}/oauth.v2.access`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString()
    })
    const answer = JSON.parse(response.body || '{}') as Answer & {
      team?: { id: string; name: string }
      bot_user_id?: string
      access_token?: string
    }
    if (!answer.ok || !answer.access_token || !answer.team) {
      throw new DependencyUnavailableException('Slack', `oauth.v2.access answered ${answer.error ?? response.status}`)
    }
    return {
      teamId: answer.team.id,
      teamName: answer.team.name,
      botUserId: answer.bot_user_id ?? '',
      token: answer.access_token
    }
  }

  /** Nobody with that address is a normal answer, not a failure. */
  async userByEmail(token: string, email: string): Promise<string | null> {
    try {
      const answer = (await this.call('users.lookupByEmail', { email }, token)) as Answer & { user?: { id: string } }
      return answer.user?.id ?? null
    } catch (error) {
      if (String((error as Error).message).includes('users_not_found')) {
        return null
      }
      throw error
    }
  }

  async post(
    token: string,
    message: { channel: string; text: string; blocks?: Block[]; threadTs?: string }
  ): Promise<void> {
    const { threadTs, ...rest } = message
    await this.call(
      'chat.postMessage',
      { ...rest, ...(threadTs ? { thread_ts: threadTs } : {}), unfurl_links: false },
      token
    )
  }

  async unfurl(
    token: string,
    channel: string,
    ts: string,
    unfurls: Record<string, { blocks: Block[] }>
  ): Promise<void> {
    await this.call('chat.unfurl', { channel, ts, unfurls }, token)
  }
}

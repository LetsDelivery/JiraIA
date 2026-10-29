import { createSign } from 'node:crypto'

import { type Clock, DependencyUnavailableException, ValidationException } from '@jiraia/core'
import type { HttpClient } from '@jiraia/http'

/**
 * What JiraIA asks of GitHub's REST API (Etapa 9, ADR-0038). The service owns this type; `HttpGitHubApi`
 * is the real one, and the suites reach it through MSW.
 */
export type Installation = { id: string; account: string }

export type GitHubApi = {
  /** An installation of the JiraIA App, read as the App; refused when it is not one of the App's. */
  installation(installationId: string): Promise<Installation>
}

export type GitHubAppKeys = { appId: string; privateKey: string }

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * The App's own token: a JWT signed with its private key (RS256), good for nine minutes and dated a
 * minute back, as GitHub asks, so a clock slightly ahead of GitHub's is not refused.
 */
export const appJwt = (keys: GitHubAppKeys, now: Date): string => {
  const seconds = Math.floor(now.getTime() / 1000)
  const unsigned = `${base64url({ alg: 'RS256', typ: 'JWT' })}.${base64url({ iat: seconds - 60, exp: seconds + 540, iss: keys.appId })}`
  return `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(keys.privateKey, 'base64url')}`
}

/**
 * A key kept in Secrets Manager or an environment variable may arrive with its line breaks written as
 * `\n`; PEM needs them real.
 */
export const pemOf = (key: string): string => key.replace(/\\n/g, '\n')

export class HttpGitHubApi implements GitHubApi {
  constructor(
    private readonly http: HttpClient,
    private readonly options: { apiUrl: string; clock: Clock; keys: GitHubAppKeys | undefined }
  ) {}

  private headers(): Record<string, string> {
    if (!this.options.keys) {
      throw new DependencyUnavailableException('GitHub', 'the GitHub App is not configured yet (GITHUB_APP_ID)')
    }
    return {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${appJwt(this.options.keys, this.options.clock.now())}`,
      'User-Agent': 'JiraIA',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  }

  async installation(installationId: string): Promise<Installation> {
    const response = await this.http.send({
      method: 'GET',
      url: `${this.options.apiUrl}/app/installations/${encodeURIComponent(installationId)}`,
      headers: this.headers()
    })
    if (response.status === 404) {
      throw new ValidationException(`Installation "${installationId}" is not one of the JiraIA GitHub App's`)
    }
    if (response.status !== 200) {
      throw new DependencyUnavailableException('GitHub', `GET /app/installations answered ${response.status}`)
    }
    const answer = JSON.parse(response.body) as { id: number; account?: { login?: string } }
    return { id: String(answer.id), account: answer.account?.login ?? '' }
  }
}

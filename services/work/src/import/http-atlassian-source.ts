import type { HttpClient } from '@jiraia/http'
import { z } from 'zod'

import { type AtlassianCredentials, AtlassianHttp, realSleep, type Sleep } from './atlassian-http.js'
import {
  type AtlassianSource,
  type IssueRecord,
  type IssueStub,
  issueStubSchema,
  type JiraProject,
  jiraProjectSchema,
  type Raw
} from './atlassian-source.js'

const PAGE = 100

const rawSchema = z.record(z.string(), z.unknown())
const offsetPageSchema = z.looseObject({ startAt: z.number(), total: z.number() })
const searchPageSchema = z.object({
  issues: z.array(issueStubSchema),
  nextPageToken: z.string().optional()
})

/** Jira Cloud's REST API v3, read-only, with the Jira token. */
export class HttpAtlassianSource implements AtlassianSource {
  private readonly jira: AtlassianHttp

  constructor(http: HttpClient, credentials: Omit<AtlassianCredentials, 'confluenceToken'>, sleep: Sleep = realSleep) {
    const api = credentials.apiUrl ?? 'https://api.atlassian.com'
    const base = `${api}/ex/jira/${credentials.cloudId}/rest/api/3`
    this.jira = new AtlassianHttp(
      http,
      { name: 'Jira', base, email: credentials.email, token: credentials.jiraToken },
      sleep
    )
  }

  async projects(): Promise<JiraProject[]> {
    const projects: JiraProject[] = []
    for (let startAt = 0, last = false; !last; startAt += 50) {
      const page = await this.jira.object(
        `/project/search?startAt=${startAt}&maxResults=50&expand=description,lead,issueTypes`
      )
      const values = z.array(jiraProjectSchema).parse(page.values)
      projects.push(...values)
      last = page.isLast === true || values.length === 0
    }
    return projects
  }

  async fields(): Promise<Raw[]> {
    return z.array(rawSchema).parse(await this.jira.json('GET', '/field'))
  }

  async count(jql: string): Promise<number> {
    const body = await this.jira.json('POST', '/search/approximate-count', { jql })
    return z.object({ count: z.number() }).parse(body).count
  }

  async *issueStubs(jql: string): AsyncIterable<IssueStub> {
    let nextPageToken: string | undefined
    do {
      const body = await this.jira.json('POST', '/search/jql', {
        jql,
        fields: ['updated'],
        maxResults: PAGE,
        nextPageToken
      })
      const page = searchPageSchema.parse(body)
      yield* page.issues
      nextPageToken = page.nextPageToken
    } while (nextPageToken)
  }

  async issue(id: string): Promise<IssueRecord> {
    const issue = await this.jira.object(`/issue/${id}?fields=*all&expand=renderedFields,names,schema,properties`)
    return {
      issue,
      changelog: await this.offsetPages(`/issue/${id}/changelog`, 'values'),
      comments: await this.offsetPages(`/issue/${id}/comment`, 'comments', '&expand=renderedBody'),
      worklogs: await this.offsetPages(`/issue/${id}/worklog`, 'worklogs')
    }
  }

  /** `redirect=false` answers the bytes from Jira itself instead of a redirect to Atlassian's media host. */
  async attachment(id: string): Promise<Uint8Array> {
    return await this.jira.bytes(`/attachment/content/${id}?redirect=false`)
  }

  async watchers(issueId: string): Promise<Raw[]> {
    const answer = await this.jira.object(`/issue/${issueId}/watchers`)
    return z.array(rawSchema).parse(answer.watchers ?? [])
  }

  async projectStatuses(projectKey: string): Promise<Raw[]> {
    return z.array(rawSchema).parse(await this.jira.json('GET', `/project/${projectKey}/statuses`))
  }

  /** At most 90 ids a call; an id Jira no longer knows is simply absent. */
  async users(accountIds: string[]): Promise<Raw[]> {
    const users: Raw[] = []
    for (let start = 0; start < accountIds.length; start += 90) {
      const query = accountIds.slice(start, start + 90).map((id) => `accountId=${encodeURIComponent(id)}`)
      const page = await this.jira.object(`/user/bulk?maxResults=90&${query.join('&')}`)
      users.push(...z.array(rawSchema).parse(page.values ?? []))
    }
    return users
  }

  /** Every item of an endpoint paged by `startAt`/`total`, under the list's own name. */
  private async offsetPages(path: string, list: string, extra = ''): Promise<Raw[]> {
    const items: Raw[] = []
    for (let startAt = 0, total = 1; startAt < total; ) {
      const page = await this.jira.object(`${path}?startAt=${startAt}&maxResults=${PAGE}${extra}`)
      const values = z.array(rawSchema).parse(page[list] ?? [])
      items.push(...values)
      total = offsetPageSchema.parse(page).total
      startAt += values.length || total
    }
    return items
  }
}

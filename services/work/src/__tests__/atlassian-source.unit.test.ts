import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { DependencyUnavailableException } from '@jiraia/core'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { HttpAtlassianSource } from '../import/http-atlassian-source.js'

/**
 * Etapa 8a: the importer reads Jira Cloud's REST API with a scoped token, on `api.atlassian.com` under
 * the cloud id. Jira is MSW on a counterparty host.
 */
const API = 'https://atlassian.counterparty.test'
const JIRA = `${API}/ex/jira/cloud-1/rest/api/3`

const auths: (string | null)[] = []
const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  auths.length = 0
})
afterAll(() => server.close())

const waits: number[] = []
const source = new HttpAtlassianSource(
  createHttpClient({ provider: 'jira', logger: createLogger('work', 'import') }),
  { cloudId: 'cloud-1', email: 'stenio.lima@parceiro.lets.delivery', jiraToken: 'scoped-token', apiUrl: API },
  async (ms) => {
    waits.push(ms)
  }
)

const stub = (id: string) => ({ id, key: `TEC-${id}`, fields: { updated: '2026-10-28T10:00:00.000-0300' } })

describe('Jira over HTTP', () => {
  it('signs with the account and its token, and follows the search pages to the end', async () => {
    server.use(
      http.post(`${JIRA}/search/jql`, async ({ request }) => {
        auths.push(request.headers.get('authorization'))
        const body = (await request.json()) as { nextPageToken?: string }
        return HttpResponse.json(
          body.nextPageToken ? { issues: [stub('2')] } : { issues: [stub('1')], nextPageToken: 'p2' }
        )
      })
    )
    const ids: string[] = []
    for await (const issue of source.issueStubs('project = "TEC"')) {
      ids.push(issue.id)
    }

    expect(ids).toEqual(['1', '2'])
    const expected = `Basic ${Buffer.from('stenio.lima@parceiro.lets.delivery:scoped-token').toString('base64')}`
    expect(auths).toEqual([expected, expected])
  })

  it('brings every page of the changelog, comments and worklogs with the issue', async () => {
    server.use(
      http.get(`${JIRA}/issue/7`, () => HttpResponse.json({ id: '7', key: 'TEC-7', fields: {} })),
      http.get(`${JIRA}/issue/7/changelog`, ({ request }) => {
        const startAt = Number(new URL(request.url).searchParams.get('startAt'))
        return HttpResponse.json({
          startAt,
          total: 3,
          values: startAt === 0 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }]
        })
      }),
      http.get(`${JIRA}/issue/7/comment`, () => HttpResponse.json({ startAt: 0, total: 1, comments: [{ id: 'c1' }] })),
      http.get(`${JIRA}/issue/7/worklog`, () => HttpResponse.json({ startAt: 0, total: 0, worklogs: [] }))
    )
    const record = await source.issue('7')

    expect(record.changelog.map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(record.comments).toEqual([{ id: 'c1' }])
    expect(record.worklogs).toEqual([])
  })

  it('waits and asks again when Jira says too many requests', async () => {
    let calls = 0
    server.use(
      http.post(`${JIRA}/search/approximate-count`, () => {
        calls += 1
        return calls < 3 ? new HttpResponse(null, { status: 429 }) : HttpResponse.json({ count: 3237 })
      })
    )
    waits.length = 0

    expect(await source.count('project = "TEC"')).toBe(3237)
    expect(waits).toEqual([2_000, 4_000])
  })

  it('downloads an attachment as bytes from Jira itself, not through a redirect', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff])
    server.use(
      http.get(`${JIRA}/attachment/content/12503`, ({ request }) =>
        new URL(request.url).searchParams.get('redirect') === 'false'
          ? new HttpResponse(bytes)
          : new HttpResponse(null, { status: 303 })
      )
    )

    expect(await source.attachment('12503')).toEqual(bytes)
  })

  it('turns any other refusal into an unavailable dependency, without the query string', async () => {
    server.use(http.get(`${JIRA}/field`, () => new HttpResponse(null, { status: 401 })))

    const error = await source.fields().catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DependencyUnavailableException)
    expect((error as Error).message).toBe('Jira is unavailable: GET /field answered 401')
  })
})

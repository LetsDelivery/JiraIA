import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'
import { createHttpClient } from '@jiraia/http'
import { createLogger } from '@jiraia/logger'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'

import { HttpConfluenceSource } from '../import/http-confluence-source.js'

/** Etapa 8a: the importer reads Confluence's REST API v2 with its own scoped token. MSW plays Confluence. */
const API = 'https://atlassian.counterparty.test'
const WIKI = `${API}/ex/confluence/cloud-1/wiki`

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const source = new HttpConfluenceSource(
  createHttpClient({ provider: 'confluence', logger: createLogger('work', 'import') }),
  { cloudId: 'cloud-1', email: 'stenio.lima@parceiro.lets.delivery', confluenceToken: 'conf-token', apiUrl: API },
  async () => {}
)

describe('Confluence over HTTP', () => {
  it('follows the cursor of a listing to the end, with the Confluence token', async () => {
    const auths: (string | null)[] = []
    server.use(
      http.get(`${WIKI}/api/v2/folders/f1/direct-children`, ({ request }) => {
        auths.push(request.headers.get('authorization'))
        const cursor = new URL(request.url).searchParams.get('cursor')
        return HttpResponse.json(
          cursor
            ? { results: [{ id: 'w1', type: 'whiteboard' }] }
            : {
                results: [{ id: 'p1', type: 'page', title: 'Guia' }],
                _links: { next: '/wiki/api/v2/folders/f1/direct-children?limit=250&cursor=abc' }
              }
        )
      })
    )

    expect(await source.children({ id: 'f1', type: 'folder' })).toEqual([
      { id: 'p1', type: 'page' },
      { id: 'w1', type: 'whiteboard' }
    ])
    expect(auths[0]).toBe(`Basic ${Buffer.from('stenio.lima@parceiro.lets.delivery:conf-token').toString('base64')}`)
  })

  it('brings a page’s comments with their replies, however deep', async () => {
    const list = (results: unknown[]) => HttpResponse.json({ results })
    server.use(
      http.get(`${WIKI}/api/v2/pages/p1/versions`, () => list([{ number: 1 }])),
      http.get(`${WIKI}/api/v2/pages/p1/footer-comments`, () => list([{ id: 'f1' }])),
      http.get(`${WIKI}/api/v2/footer-comments/f1/children`, () => list([{ id: 'f2' }])),
      http.get(`${WIKI}/api/v2/footer-comments/f2/children`, () => list([])),
      http.get(`${WIKI}/api/v2/pages/p1/inline-comments`, () => list([])),
      http.get(`${WIKI}/api/v2/pages/p1/attachments`, () => list([{ id: 'a1', fileSize: 10 }]))
    )
    const extras = await source.pageExtras('p1')

    expect(extras.footerComments).toEqual([{ id: 'f1', replies: [{ id: 'f2', replies: [] }] }])
    expect(extras.versions).toEqual([{ number: 1 }])
    expect(extras.attachments).toEqual([{ id: 'a1', fileSize: 10 }])
  })
})

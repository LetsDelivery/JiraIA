import type { HttpClient } from '@jiraia/http'
import { z } from 'zod'

import { type AtlassianCredentials, AtlassianHttp, realSleep, type Sleep } from './atlassian-http.js'
import type { Raw } from './atlassian-source.js'
import {
  type ConfluenceNode,
  type ConfluenceSource,
  type ConfluenceSpace,
  type NodeType,
  nodeSchema,
  type PageExtras,
  spaceSchema
} from './confluence-source.js'

const BODY = 'body-format=atlas_doc_format'
const PLURAL: Record<NodeType, string> = {
  page: 'pages',
  folder: 'folders',
  whiteboard: 'whiteboards',
  database: 'databases',
  embed: 'embeds'
}

const listSchema = z.object({
  results: z.array(z.record(z.string(), z.unknown())),
  _links: z.looseObject({ next: z.string().optional() }).optional()
})

/** Confluence Cloud's REST API v2, read-only, with the Confluence token. */
export class HttpConfluenceSource implements ConfluenceSource {
  private readonly confluence: AtlassianHttp

  constructor(http: HttpClient, credentials: Omit<AtlassianCredentials, 'jiraToken'>, sleep: Sleep = realSleep) {
    const api = credentials.apiUrl ?? 'https://api.atlassian.com'
    const base = `${api}/ex/confluence/${credentials.cloudId}/wiki`
    const app = { name: 'Confluence' as const, base, email: credentials.email, token: credentials.confluenceToken }
    this.confluence = new AtlassianHttp(http, app, sleep)
  }

  async spaces(keys: string[]): Promise<ConfluenceSpace[]> {
    return z.array(spaceSchema).parse(await this.all(`/api/v2/spaces?keys=${keys.join(',')}&limit=250`))
  }

  async roots(spaceId: string): Promise<ConfluenceNode[]> {
    const pages = await this.all(`/api/v2/spaces/${spaceId}/pages?depth=root&status=current,archived&limit=250`)
    return pages.map((page) => ({ id: String(page.id), type: 'page' }))
  }

  async children(node: ConfluenceNode): Promise<ConfluenceNode[]> {
    const children = await this.all(`/api/v2/${PLURAL[node.type]}/${node.id}/direct-children?limit=250`)
    return children.map((child) => nodeSchema.parse(child)).map(({ id, type }) => ({ id, type }))
  }

  async node(node: ConfluenceNode): Promise<Raw> {
    const extra = node.type === 'page' ? `?${BODY}&include-labels=true&include-properties=true` : ''
    return await this.confluence.object(`/api/v2/${PLURAL[node.type]}/${node.id}${extra}`)
  }

  async pageExtras(pageId: string): Promise<PageExtras> {
    return {
      versions: await this.all(`/api/v2/pages/${pageId}/versions?${BODY}&limit=250`),
      footerComments: await this.thread(`/api/v2/pages/${pageId}/footer-comments?${BODY}&limit=250`, 'footer'),
      inlineComments: await this.thread(`/api/v2/pages/${pageId}/inline-comments?${BODY}&limit=250`, 'inline'),
      attachments: await this.all(`/api/v2/pages/${pageId}/attachments?limit=250`)
    }
  }

  async pageVersion(pageId: string, version: number): Promise<Raw> {
    return await this.confluence.object(`/api/v2/pages/${pageId}?${BODY}&version=${version}`)
  }

  /** Comments with their replies under `replies`, however deep. */
  private async thread(path: string, kind: 'footer' | 'inline'): Promise<Raw[]> {
    const comments = await this.all(path)
    const threaded: Raw[] = []
    for (const comment of comments) {
      const replies = await this.thread(`/api/v2/${kind}-comments/${comment.id}/children?${BODY}&limit=250`, kind)
      threaded.push({ ...comment, replies })
    }
    return threaded
  }

  /** Every item of a v2 listing, following `_links.next` (which already starts with `/wiki`). */
  private async all(path: string): Promise<Raw[]> {
    const items: Raw[] = []
    for (let next: string | undefined = path; next; ) {
      const page = listSchema.parse(await this.confluence.json('GET', next))
      items.push(...page.results)
      next = page._links?.next?.replace(/^\/wiki/, '')
    }
    return items
  }
}

import { z } from 'zod'

import type { Raw } from './atlassian-source.js'

/**
 * What the importer reads from Confluence (ADR-0036, Etapa 8a), behind a type this service owns.
 * `HttpConfluenceSource` is the real one; the suite hands in `InMemoryConfluence`.
 *
 * A space is walked as a tree: its root pages, then each node's direct children. Folders, whiteboards,
 * databases and embeds are only found that way — the token's scopes refuse a listing by space or CQL.
 */
export const nodeTypeSchema = z.enum(['page', 'folder', 'whiteboard', 'database', 'embed'])
export type NodeType = z.infer<typeof nodeTypeSchema>

export const nodeSchema = z.looseObject({ id: z.string(), type: nodeTypeSchema })
export type ConfluenceNode = { id: string; type: NodeType }

export const spaceSchema = z.looseObject({ id: z.string(), key: z.string(), name: z.string() })
export type ConfluenceSpace = z.infer<typeof spaceSchema>

/** A page as the importer keeps it: the page with its body, every version, comments and attachments. */
export type PageExtras = { versions: Raw[]; footerComments: Raw[]; inlineComments: Raw[]; attachments: Raw[] }

export type ConfluenceSource = {
  spaces(keys: string[]): Promise<ConfluenceSpace[]>
  /** The pages at the top of a space, archived ones included. */
  roots(spaceId: string): Promise<ConfluenceNode[]>
  children(node: ConfluenceNode): Promise<ConfluenceNode[]>
  /** The node itself; a page with its body in Atlassian's document format. */
  node(node: ConfluenceNode): Promise<Raw>
  /** A page's versions (without bodies), comments with their replies, and attachments. */
  pageExtras(pageId: string): Promise<PageExtras>
  /** A page as it was at one version, with that version's body. */
  pageVersion(pageId: string, version: number): Promise<Raw>
}

type FakeNode = ConfluenceNode & { space: string; parent?: string; body?: Raw; extras?: Partial<PageExtras> }

/**
 * Confluence in memory — the suite's stand-in.
 *
 * @example new InMemoryConfluence({ spaces: [{ id: '1', key: 'CS', name: 'CS' }], nodes: [{ id: 'p1', type: 'page', space: '1' }] })
 */
export class InMemoryConfluence implements ConfluenceSource {
  constructor(readonly data: { spaces: ConfluenceSpace[]; nodes: FakeNode[] }) {}

  async spaces(keys: string[]): Promise<ConfluenceSpace[]> {
    return this.data.spaces.filter((space) => keys.includes(space.key))
  }

  async roots(spaceId: string): Promise<ConfluenceNode[]> {
    return this.data.nodes
      .filter((node) => node.space === spaceId && !node.parent)
      .map(({ id, type }) => ({ id, type }))
  }

  async children(parent: ConfluenceNode): Promise<ConfluenceNode[]> {
    return this.data.nodes.filter((node) => node.parent === parent.id).map(({ id, type }) => ({ id, type }))
  }

  async node(wanted: ConfluenceNode): Promise<Raw> {
    const found = this.data.nodes.find((node) => node.id === wanted.id)
    return { id: wanted.id, type: wanted.type, ...found?.body }
  }

  async pageVersion(pageId: string, version: number): Promise<Raw> {
    return { id: pageId, version: { number: version }, body: { atlas_doc_format: { value: `v${version}` } } }
  }

  async pageExtras(pageId: string): Promise<PageExtras> {
    const extras = this.data.nodes.find((node) => node.id === pageId)?.extras ?? {}
    return {
      versions: extras.versions ?? [],
      footerComments: extras.footerComments ?? [],
      inlineComments: extras.inlineComments ?? [],
      attachments: extras.attachments ?? []
    }
  }
}

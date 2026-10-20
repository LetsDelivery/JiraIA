import { cached, forget, invalidate } from '@/lib/cache'

import { api } from './client'
import { sendFile, unwrap } from './requests'
import type { paths } from './schema'

/**
 * Let’s Draw AI's side of the API (ADR-0010, ADR-0011): its spaces, the content tree, the documents
 * edited together, versions, comments, files and drafts from a prompt.
 */
type Json<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: { '2XX': { content: { 'application/json': infer T } } }
}
  ? T
  : never
type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: { content: { 'application/json': infer T } }
}
  ? T
  : never

export type DrawSpace = Json<'/work/draw/spaces/{spaceId}', 'get'>
export type ContentNode = Json<'/work/draw/spaces/{spaceId}/contents', 'get'>['items'][number]
export type ContentKind = ContentNode['kind']
export type Content = Json<'/work/draw/contents/{contentId}', 'get'>
export type RecentContent = Json<'/work/draw/contents', 'get'>['items'][number]
export type Version = Json<'/work/draw/contents/{contentId}/versions/{number}', 'get'>
export type VersionSummary = Json<'/work/draw/contents/{contentId}/versions', 'get'>['items'][number]
export type ContentComment = Json<'/work/draw/contents/{contentId}/comments', 'get'>['items'][number]
export type Draft = Json<'/work/draw/spaces/{spaceId}/drafts', 'post'>
export type DraftRequest = Body<'/work/draw/spaces/{spaceId}/drafts', 'post'>
export type NewContent = Body<'/work/draw/spaces/{spaceId}/contents', 'post'>
export type SpaceInput = Body<'/work/draw/spaces', 'post'>
export type SpaceChanges = Body<'/work/draw/spaces/{spaceId}', 'patch'>
type Mark = 'star' | 'follow'

const content = (contentId: string) => ({ params: { path: { contentId } } })

export const drawRead = {
  spaces: () => cached('draw:spaces', () => unwrap(api.GET('/work/draw/spaces'))),
  space: (spaceId: string) =>
    cached(`draw:space:${spaceId}`, () =>
      unwrap(api.GET('/work/draw/spaces/{spaceId}', { params: { path: { spaceId } } }))
    ),
  tree: (spaceId: string) =>
    cached(`draw:space:${spaceId}:tree`, () =>
      unwrap(api.GET('/work/draw/spaces/{spaceId}/contents', { params: { path: { spaceId } } }))
    ),
  opened: () => cached('draw:opened', () => unwrap(api.GET('/work/draw/contents/opened', { params: { query: {} } }))),
  recent: () => cached('draw:recent', () => unwrap(api.GET('/work/draw/contents', { params: { query: {} } }))),
  content: (contentId: string) =>
    cached(`draw:content:${contentId}`, () => unwrap(api.GET('/work/draw/contents/{contentId}', content(contentId)))),
  document: (contentId: string) => unwrap(api.GET('/work/draw/contents/{contentId}/document', content(contentId))),
  versions: (contentId: string) =>
    cached(`draw:content:${contentId}:versions`, () =>
      unwrap(api.GET('/work/draw/contents/{contentId}/versions', content(contentId)))
    ),
  version: (contentId: string, number: number) =>
    unwrap(api.GET('/work/draw/contents/{contentId}/versions/{number}', { params: { path: { contentId, number } } })),
  comments: (contentId: string) =>
    cached(`draw:content:${contentId}:comments`, () =>
      unwrap(api.GET('/work/draw/contents/{contentId}/comments', content(contentId)))
    ),
  file: (contentId: string, fileId: string) =>
    unwrap(api.GET('/work/draw/contents/{contentId}/files/{fileId}', { params: { path: { contentId, fileId } } })),
  realtimeTicket: (contentId: string) =>
    unwrap(api.POST('/work/draw/contents/{contentId}/realtime', content(contentId)))
}

const treeOf = (spaceId: string) => `draw:space:${spaceId}:tree`

export const drawWrite = {
  createSpace: async (body: SpaceInput) => {
    const space = await unwrap(api.POST('/work/draw/spaces', { body }))
    invalidate('draw:spaces')
    return space
  },
  updateSpace: async (spaceId: string, body: SpaceChanges) => {
    const space = await unwrap(api.PATCH('/work/draw/spaces/{spaceId}', { params: { path: { spaceId } }, body }))
    invalidate('draw:spaces', `draw:space:${spaceId}`, 'draw:recent')
    return space
  },
  deleteSpace: async (spaceId: string) => {
    await unwrap(api.DELETE('/work/draw/spaces/{spaceId}', { params: { path: { spaceId } } }))
    invalidate('draw:')
  },
  /** A star or a follow: the member's own, on or off. */
  mark: async (spaceId: string, mark: Mark, on: boolean) => {
    const path = { params: { path: { spaceId, mark } } }
    await unwrap(
      on
        ? api.PUT('/work/draw/spaces/{spaceId}/marks/{mark}', path)
        : api.DELETE('/work/draw/spaces/{spaceId}/marks/{mark}', path)
    )
    invalidate('draw:spaces', `draw:space:${spaceId}`)
  },
  create: async (spaceId: string, body: NewContent) => {
    const created = await unwrap(
      api.POST('/work/draw/spaces/{spaceId}/contents', { params: { path: { spaceId } }, body })
    )
    invalidate(treeOf(spaceId), 'draw:recent')
    return created
  },
  rename: async (item: { id: string; spaceId: string }, title: string) => {
    await unwrap(api.PATCH('/work/draw/contents/{contentId}', { ...content(item.id), body: { title } }))
    invalidate(treeOf(item.spaceId), `draw:content:${item.id}`, 'draw:recent')
  },
  move: async (item: { id: string; spaceId: string }, parentId: string | null, index: number) => {
    await unwrap(api.POST('/work/draw/contents/{contentId}/move', { ...content(item.id), body: { parentId, index } }))
    invalidate(treeOf(item.spaceId))
  },
  remove: async (item: { id: string; spaceId: string }) => {
    await unwrap(api.DELETE('/work/draw/contents/{contentId}', content(item.id)))
    invalidate(treeOf(item.spaceId), 'draw:recent')
  },
  /** What the editor derived from the live document (ADR-0009); quiet — it changes nothing on screen. */
  saveDerived: async (contentId: string, body: { json: Record<string, unknown>; text: string }) => {
    const saved = await unwrap(api.PUT('/work/draw/contents/{contentId}/derived', { ...content(contentId), body }))
    forget('draw:recent')
    if (saved.version !== null) {
      forget(`draw:content:${contentId}:versions`)
    }
    return saved
  },
  /** A change too large for one WebSocket message (128 KB in AWS) goes by HTTP instead (ADR-0009). */
  pushUpdate: (contentId: string, update: string) =>
    unwrap(api.POST('/work/draw/contents/{contentId}/document', { ...content(contentId), body: { update } })),
  saveVersion: async (contentId: string, name?: string) => {
    const body = name ? { name } : {}
    const version = await unwrap(api.POST('/work/draw/contents/{contentId}/versions', { ...content(contentId), body }))
    invalidate(`draw:content:${contentId}:versions`)
    return version
  },
  restoreVersion: async (contentId: string, number: number) => {
    const version = await unwrap(
      api.POST('/work/draw/contents/{contentId}/versions/{number}/restore', { params: { path: { contentId, number } } })
    )
    invalidate(`draw:content:${contentId}:versions`)
    return version
  },
  comment: async (contentId: string, body: { body: string; parentId?: string; anchorId?: string; quote?: string }) => {
    const comments = await unwrap(api.POST('/work/draw/contents/{contentId}/comments', { ...content(contentId), body }))
    invalidate(`draw:content:${contentId}:comments`)
    return comments
  },
  resolveComment: async (contentId: string, commentId: string, resolved: boolean) => {
    const comments = await unwrap(
      api.POST('/work/draw/contents/{contentId}/comments/{commentId}/resolve', {
        params: { path: { contentId, commentId } },
        body: { resolved }
      })
    )
    invalidate(`draw:content:${contentId}:comments`)
    return comments
  },
  /** An image or file into a page: announce it, send the bytes to storage, confirm (5.2). */
  uploadFile: async (contentId: string, file: File) => {
    const body = { name: file.name, contentType: file.type || 'application/octet-stream', size: file.size }
    const started = await unwrap(api.POST('/work/draw/contents/{contentId}/files', { ...content(contentId), body }))
    await sendFile(started.upload, file)
    return await unwrap(
      api.POST('/work/draw/contents/{contentId}/files/{fileId}/complete', {
        params: { path: { contentId, fileId: started.id } }
      })
    )
  },
  /** Notes that the person opened this content, for "Abertos por você" (Etapa 4d-c). */
  visit: async (contentId: string) => {
    await unwrap(api.PUT('/work/draw/contents/{contentId}/visit', content(contentId)))
    forget('draw:opened')
  },
  /** "Criar com IA": the conversation so far, drafted — nothing is created yet (ADR-0011). */
  draft: (spaceId: string, body: DraftRequest) =>
    unwrap(api.POST('/work/draw/spaces/{spaceId}/drafts', { params: { path: { spaceId } }, body }))
}

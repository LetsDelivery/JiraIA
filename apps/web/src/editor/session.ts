import { IndexeddbPersistence } from 'y-indexeddb'
import * as Y from 'yjs'

import { type Content, drawWrite } from '@/api/draw'

import { ContentProvider, type ProviderStatus } from './provider'

/** How long editing pauses before the derived content is saved (ADR-0009). */
const SAVE_AFTER_MS = 1500

/** Caret colours, one per person, picked from their id so it stays the same on every screen. */
const CARET_COLORS = ['#e5484d', '#3e63dd', '#30a46c', '#f76b15', '#8e4ec6', '#0090ff', '#d6409f', '#12a594']

export const caretColor = (id: string): string =>
  CARET_COLORS[[...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % CARET_COLORS.length] as string

/**
 * What edits a document on screen — the page editor or the whiteboard — as the session needs it: its
 * element, what it derives for search and versions, and the few switches the session flips.
 */
export type Surface = {
  root: HTMLElement
  derive: () => { json: Record<string, unknown>; text: string }
  isEmpty: () => boolean
  /** Fills an empty document from the content's stored JSON (seeded, imported, or drafted). */
  seed: (json: Record<string, unknown>) => void
  setEditable: (editable: boolean) => void
  destroy: () => void
}

export type Session<S extends Surface = Surface> = {
  contentId: string
  surface: S
  provider: ContentProvider
  status: ProviderStatus
  /** Saves now what is waiting for the pause, if anything is — before leaving or taking a version. */
  flush: () => Promise<void>
  /** A whiteboard's copy in this browser (Etapa 4d-c), so a dropped connection loses nothing. */
  offline?: IndexeddbPersistence | undefined
}

let current: Session | undefined
let statusListener: (status: ProviderStatus) => void = () => undefined

/**
 * The open document's editor, kept across the screen's re-renders: the app redraws a view whenever
 * data changes, and an editor rebuilt each time would lose the cursor, the selection and the socket.
 */
export const openSession = <S extends Surface>(
  content: Content,
  build: (doc: Y.Doc, provider: ContentProvider) => S
): Session<S> => {
  if (current?.contentId === content.id) {
    return current as Session<S>
  }
  closeSession()
  const doc = new Y.Doc()
  const onStatus = (next: ProviderStatus) => {
    session.status = next
    statusListener(next)
  }
  const provider = new ContentProvider({ contentId: content.id, doc, canWrite: content.canWrite, onStatus })
  const session: Session<S> = {
    contentId: content.id,
    status: 'connecting',
    provider,
    surface: build(doc, provider),
    flush: async () => undefined
  }
  session.flush = _saver(content, session, doc)
  session.offline = _offline(content, doc)
  current = session
  void provider.start().then(() => _ready(session, content))
  return session
}

/**
 * Debounced: one save after a pause in editing. `flush` saves now what was waiting — and waits for a
 * save already on its way, so a version taken right after holds the latest text.
 */
const _saver = (content: Content, session: Session, doc: Y.Doc) => {
  let timer: number | undefined
  let inflight: Promise<void> = Promise.resolve()
  const save = async () => {
    window.clearTimeout(timer)
    timer = undefined
    inflight = drawWrite.saveDerived(content.id, session.surface.derive()).then(
      () => undefined,
      () => undefined
    )
    await inflight
  }
  doc.on('update', (_update: Uint8Array, origin: unknown) => {
    if (origin !== session.provider && content.canWrite) {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void save(), SAVE_AFTER_MS)
    }
  })
  return async () => (timer === undefined ? await inflight : await save())
}

/**
 * The document is loaded: the surface opens for editing. Content with stored JSON but no Yjs document
 * yet — seeded, brought from Confluence, or drafted from a prompt — is filled from it first, by whoever
 * opens it first. Two people opening such content in the same instant would both fill it; it happens
 * once per item.
 */
const _ready = (session: Session, content: Content) => {
  if (content.canWrite && session.surface.isEmpty() && _hasContent(content.contentJson)) {
    session.surface.seed(content.contentJson)
  }
  session.surface.setEditable(content.canWrite)
}

/** A page's blocks, a whiteboard's elements (ADR-0017), or the shapes of a board drawn before them. */
const _hasContent = (json: Record<string, unknown>): boolean =>
  ['content', 'elements', 'shapes'].some((key) => ((json[key] as unknown[] | undefined)?.length ?? 0) > 0)

/** Puts the open surface in the screen just drawn. */
export const mountSession = (host: HTMLElement, onStatus: (status: ProviderStatus) => void): Session | undefined => {
  if (!current) {
    return undefined
  }
  statusListener = onStatus
  host.append(current.surface.root)
  onStatus(current.status)
  return current
}

export const currentSession = (): Session | undefined => current

/** Leaving the document: the last change is saved and the connection closed. */
export const closeSession = (): void => {
  const leaving = current
  current = undefined
  if (!leaving) {
    return
  }
  void leaving.flush()
  leaving.surface.destroy()
  leaving.provider.destroy()
  void leaving.offline?.destroy()
}

/**
 * A whiteboard keeps a copy of its document in this browser (IndexedDB). What is drawn while the
 * connection is down stays here and merges into the shared document when it comes back — Yjs merges
 * both ways, so the copy never overwrites what others did meanwhile. Pages stay as they were.
 */
const _offline = (content: Content, doc: Y.Doc): IndexeddbPersistence | undefined =>
  content.kind === 'whiteboard' && content.canWrite && typeof indexedDB !== 'undefined'
    ? new IndexeddbPersistence(`jiraia:board:${content.id}`, doc)
    : undefined

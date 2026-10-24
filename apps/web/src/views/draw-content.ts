import type { Editor } from '@tiptap/core'

import { type Content, type ContentNode, drawRead, drawWrite } from '@/api/draw'
import { type Member, read } from '@/api/requests'
import { invalidate } from '@/lib/cache'
import { ancestorsOf } from '@/lib/content-tree'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { type Area, pathsIn } from '@/lib/wiki'
import { bindCommentsPanel, commentsPanel, focusThread, startInlineComment } from '@/ui/content-comments'
import { bindVersionsPanel, versionsPanel } from '@/ui/content-versions'
import { openCreateMenu } from '@/ui/create-menu'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import { attachBubble, bubbleMenu, insertBoard, insertCard, insertFile } from './page-actions'

/**
 * The editors — TipTap, Yjs and the whiteboard, most of the panel's weight — load the first time a
 * page or a whiteboard opens, not with the rest of the panel.
 */
type Editors = {
  sessions: typeof import('@/editor/session')
  pages: typeof import('@/editor/page-surface')
  boards: typeof import('@/whiteboard/whiteboard')
  toolbar: typeof import('@/ui/whiteboard-toolbar')
  style: typeof import('@/ui/whiteboard-style')
}
let editors: Editors | undefined
export const loadEditors = async (): Promise<Editors> => {
  editors ??= {
    sessions: await import('@/editor/session'),
    pages: await import('@/editor/page-surface'),
    boards: await import('@/whiteboard/whiteboard'),
    toolbar: await import('@/ui/whiteboard-toolbar'),
    style: await import('@/ui/whiteboard-style')
  }
  return editors
}
export const closeEditors = (): void => editors?.sessions.closeSession()

export type Loaded = {
  me: { id: string; name: string }
  content: Content
  nodes: ContentNode[]
  members: Member[]
  spaceName: string
  /** Draw's or the wiki's: where its links lead and what can be created in it (ADR-0033). */
  area: Area
}

export const loadContent = async (spaceId: string, contentId: string, area: Area = 'draw'): Promise<Loaded> => {
  const [me, content, tree, members, space] = await Promise.all([
    read.me(),
    drawRead.content(contentId),
    drawRead.tree(spaceId),
    read.members(),
    drawRead.space(spaceId)
  ])
  return { me, content, nodes: tree.items, members: members.items, spaceName: space.name, area }
}

const STATUS: Record<string, string> = {
  connecting: 'Conectando…',
  online: 'Ao vivo',
  offline: 'Sem conexão — as alterações esperam'
}

const panelOf = (): 'comentarios' | 'versoes' =>
  new URLSearchParams(location.search).get('painel') === 'versoes' ? 'versoes' : 'comentarios'

const breadcrumbs = (data: Loaded): Html => html`
  <nav class="breadcrumbs" aria-label="Caminho">
    <a href="${pathsIn(data.area).space(data.content.spaceId)}">${data.spaceName}</a>
    ${ancestorsOf(data.nodes, data.content.id).map(
      (node) =>
        html`<span aria-hidden="true">/</span><a href="${pathsIn(data.area).content(data.content.spaceId, node.id)}">${node.title}</a>`
    )}
  </nav>
`

const titleRow = (data: Loaded): Html => html`
  <header class="page-title-row">
    <label class="sr-only" for="page-title">Título</label>
    <input id="page-title" class="page-title" data-page-title value="${data.content.title}" maxlength="255" />
    <div class="page-meta">
      <span class="page-presence" data-presence></span>
      <span class="page-status muted" data-page-status role="status"></span>
    </div>
  </header>
`

const panelTabs = (data: Loaded, current: string, comments: number): Html => {
  const path = pathsIn(data.area).content(data.content.spaceId, data.content.id)
  return html`
    <nav class="tabs page-panel-tabs" aria-label="Painel">
      <a class="tab" href="${path}" ${current === 'comentarios' ? html`aria-current="page"` : ''}>${icon('message', 16)}Comentários <span class="count">${comments}</span></a>
      <a class="tab" href="${path}?painel=versoes" ${current === 'versoes' ? html`aria-current="page"` : ''}>${icon('history', 16)}Versões</a>
    </nav>
  `
}

const currentSurface = () => editors?.sessions.currentSession()?.surface

const panel = async (data: Loaded): Promise<Html> => {
  const id = data.content.id
  if (panelOf() === 'versoes') {
    const versions = await drawRead.versions(id)
    return versionsPanel(versions.items, {
      contentId: id,
      canWrite: data.content.canWrite,
      currentText: () => currentSurface()?.derive().text ?? '',
      apply: () => undefined,
      flush: async () => await editors?.sessions.currentSession()?.flush()
    })
  }
  const comments = await drawRead.comments(id)
  const editor = (currentSurface() as { editor?: Editor } | undefined)?.editor
  return commentsPanel(comments.items, { contentId: id, members: data.members, editor })
}

/** A page or a whiteboard: its path, its title, the surface in the middle, comments or versions beside. */
export const documentScreen = async (data: Loaded): Promise<Html> => {
  const open = (await drawRead.comments(data.content.id)).items.filter((each) => !each.parentId && !each.resolvedAt)
  const board = data.content.kind === 'whiteboard'
  return html`
    <div class="page-layout ${board ? 'is-board' : ''}">
      <article class="page-main">
        ${breadcrumbs(data)}
        ${titleRow(data)}
        ${
          board
            ? html`<div class="wb-stage"><div data-editor-host class="board-host"></div>
              <div class="wb-toolbar-host" data-board-toolbar></div><div class="wb-panel-host" data-board-style></div></div>`
            : html`<div class="page-toolbar" data-format-host></div><div data-editor-host></div>`
        }
      </article>
      <aside class="page-panel">${panelTabs(data, panelOf(), open.length)}${await panel(data)}</aside>
    </div>
  `
}

/** A folder: what is in it, and the ways to add more. */
export const folderScreen = (data: Loaded): Html => {
  const children = data.nodes
    .filter((node) => node.parentId === data.content.id)
    .sort((a, b) => a.position - b.position)
  return html`
    ${breadcrumbs(data)}
    <header class="page-header"><div class="row">${icon('folder', 24)}<h1>${data.content.title}</h1>
      ${data.content.canWrite ? html`<button type="button" class="button button-primary" data-create-here>${icon('plus', 16)}Criar</button>` : ''}</div></header>
    ${
      children.length
        ? html`<ul class="search-results">${children.map(
            (
              node
            ) => html`<li class="search-result"><a class="search-result-link" href="${pathsIn(data.area).content(data.content.spaceId, node.id)}">
              ${icon(node.kind === 'folder' ? 'folder' : node.kind === 'page' ? 'fileText' : 'chalkboard', 16)}
              <span class="search-result-title">${node.title}</span></a></li>`
          )}</ul>`
        : html`<p class="empty muted">A pasta está vazia. Crie uma página, um quadro ou algo com IA.</p>`
    }
  `
}

export const bindFolder = (root: HTMLElement, data: Loaded): void => {
  root.querySelector<HTMLElement>('[data-create-here]')?.addEventListener('click', (event) =>
    openCreateMenu(event.currentTarget as HTMLElement, {
      spaceId: data.content.spaceId,
      parentId: data.content.id,
      area: data.area
    })
  )
}

/** Opens the content's live surface — a page editor or a board — and wires the screen around it. */
export const bindDocument = (root: HTMLElement, data: Loaded): void => {
  if (!editors) {
    return
  }
  const { sessions } = editors
  const redraw = () => invalidate(`draw:content:${data.content.id}:ui`)
  const session = data.content.kind === 'whiteboard' ? openBoard(editors, data) : openPage(editors, data, redraw)
  const status = root.querySelector<HTMLElement>('[data-page-status]')
  sessions.mountSession(root.querySelector('[data-editor-host]') as HTMLElement, (next) => {
    if (status) {
      status.textContent = STATUS[next] ?? ''
      status.dataset.state = next
    }
  })
  const toolbar = 'toolbar' in session.surface ? session.surface.toolbar : undefined
  if (toolbar) {
    root.querySelector('[data-format-host]')?.append(toolbar)
  }
  bindTitle(root, data.content)
  bindPresence(root, session.provider.awareness)
  bindPanels(root, data, session, redraw)
}

const openPage = (loaded: Editors, data: Loaded, redraw: () => void) => {
  const session = loaded.sessions.openSession(
    data.content,
    loaded.pages.pageSurface({
      content: data.content,
      me: data.me,
      members: data.members,
      bubble: bubbleMenu((editor) => startInlineComment(data.content.id, editor, redraw)),
      insertFile: (editor, kind) => insertFile(data.content.id, editor, kind),
      insertCard: (editor) => insertCard(editor),
      insertBoard: (editor) =>
        void insertBoard(data.content.spaceId, editor).catch((refusal: unknown) =>
          toast(refusalSentence(refusal), 'error')
        )
    })
  )
  attachBubble(session.surface.bubble, session.surface.editor)
  return session
}

const openBoard = (loaded: Editors, data: Loaded) =>
  loaded.sessions.openSession(data.content, (doc, provider) => {
    const color = loaded.sessions.caretColor(data.me.id)
    const files = {
      upload: async (file: File) => (await drawWrite.uploadFile(data.content.id, file)).id,
      url: async (fileId: string) => (await drawRead.file(data.content.id, fileId)).url
    }
    return new loaded.boards.Whiteboard(doc, provider.awareness, { name: data.me.name, color }, files)
  })

type OpenSession = ReturnType<typeof openPage> | ReturnType<typeof openBoard>

const bindPanels = (root: HTMLElement, data: Loaded, session: OpenSession, redraw: () => void) => {
  const surface = session.surface as OpenSession['surface']
  const editor = 'editor' in surface ? surface.editor : undefined
  const board = 'replace' in surface ? surface : undefined
  const toolbarHost = root.querySelector<HTMLElement>('[data-board-toolbar]')
  const styleHost = root.querySelector<HTMLElement>('[data-board-style]')
  if (board && toolbarHost && styleHost && editors) {
    editors.toolbar.mountWhiteboardToolbar(toolbarHost, board, {
      title: () => root.querySelector<HTMLInputElement>('[data-page-title]')?.value ?? data.content.title,
      saveVersion: async (name?: string) => {
        await session.flush()
        await drawWrite.saveVersion(data.content.id, name)
      }
    })
    editors.style.mountStylePanel(styleHost, board)
  }
  if (editor) {
    bindThreads(root, editor)
  }
  bindCommentsPanel(root, { contentId: data.content.id, members: data.members, editor }, redraw)
  bindVersionsPanel(
    root,
    {
      contentId: data.content.id,
      canWrite: data.content.canWrite,
      currentText: () => surface.derive().text,
      apply: (json) => (board ? board.replace(json) : editor?.commands.setContent(json)),
      flush: session.flush
    },
    redraw
  )
}

const bindTitle = (root: HTMLElement, content: Content): void => {
  const input = root.querySelector<HTMLInputElement>('[data-page-title]')
  input?.addEventListener('change', () => {
    const title = input.value.trim()
    if (title && title !== content.title) {
      drawWrite.rename(content, title).catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    }
  })
}

type Awareness = {
  getStates: () => Map<number, Record<string, unknown>>
  on: (event: string, listener: () => void) => void
  off: (event: string, listener: () => void) => void
}

/** Who else has it open, by the name and colour of their cursor (5.3). */
const bindPresence = (root: HTMLElement, awareness: Awareness): void => {
  const holder = root.querySelector<HTMLElement>('[data-presence]')
  const draw = () => {
    if (!holder?.isConnected) {
      awareness.off('change', draw)
      return
    }
    const people = [...awareness.getStates().values()]
      .map((state) => state.user as { name?: string; color?: string } | undefined)
      .filter((user): user is { name: string; color: string } => Boolean(user?.name))
    holder.innerHTML = html`${people.map(
      (user) =>
        html`<span class="avatar presence" style="--presence: ${user.color}" title="${user.name}">${user.name.slice(0, 1).toUpperCase()}</span>`
    )}`.value
  }
  awareness.on('change', draw)
  draw()
}

/** Clicking marked text opens its thread in the panel (5.7). */
const bindThreads = (root: HTMLElement, editor: Editor): void => {
  const open = () => {
    if (!root.isConnected) {
      editor.off('selectionUpdate', open)
      return
    }
    const anchorId = editor.state.selection.$from.marks().find((mark) => mark.type.name === 'comment')?.attrs.id as
      | string
      | undefined
    if (anchorId) {
      focusThread(root, anchorId)
    }
  }
  editor.on('selectionUpdate', open)
}

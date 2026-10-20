import { type ContentNode, drawWrite } from '@/api/draw'
import { ancestorsOf, buildTree, type DropZone, dropTarget, type TreeItem } from '@/lib/content-tree'
import { contentPath, drawSpacePath } from '@/lib/draw'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { persistedStore } from '@/lib/store'

import { openCreateMenu } from './create-menu'
import { type IconName, icon } from './icons'
import { toast } from './toast'

export type TreeContext = {
  spaceId: string
  /** Every item of the space; `shown` is what the search and the filter let through. */
  nodes: readonly ContentNode[]
  shown: readonly ContentNode[]
  /** The item open on screen, if any: it is marked, and the folders above it stay open. */
  currentId?: string | undefined
  /** While searching, every folder opens, so each match shows where it lives. */
  searching: boolean
  /** Whether the viewer edits the space: who only reads gets no create, delete or drag (ADR-0012). */
  canWrite: boolean
}

/** Which folders are closed, per viewer, on this browser. */
const folded = persistedStore<string[]>('jiraia.draw.folded', [])

const KIND_ICON: Record<ContentNode['kind'], IconName> = {
  folder: 'folder',
  page: 'fileText',
  whiteboard: 'chalkboard'
}

const toggle = (item: TreeItem<ContentNode>, expanded: boolean): Html =>
  item.children.length > 0
    ? html`<button type="button" class="page-tree-toggle" data-fold="${item.id}" aria-label="${expanded ? 'Recolher' : 'Expandir'} ${item.title}">${icon('chevronRight', 14)}</button>`
    : html`<span class="page-tree-toggle" aria-hidden="true"></span>`

const actions = (item: TreeItem<ContentNode>): Html => html`
  <span class="page-tree-actions">
    ${item.kind === 'whiteboard' ? '' : html`<button type="button" class="nav-action" data-add-inside="${item.id}" aria-label="Criar dentro de ${item.title}" title="Criar dentro">${icon('plus', 14)}</button>`}
    <button type="button" class="nav-action" data-delete-content="${item.id}" aria-label="Excluir ${item.title}" title="Excluir">${icon('trash', 14)}</button>
  </span>
`

const row = (item: TreeItem<ContentNode>, context: TreeContext, open: ReadonlySet<string>): Html => {
  const expanded = item.children.length > 0 && open.has(item.id)
  const current = item.id === context.currentId
  const glyph = item.kind === 'folder' && expanded ? 'folderOpen' : KIND_ICON[item.kind]
  return html`
    <li role="treeitem" data-content-id="${item.id}" ${item.children.length ? html`aria-expanded="${expanded}"` : ''}>
      <div class="page-tree-row ${current ? 'is-active' : ''}" draggable="${context.canWrite}">
        ${toggle(item, expanded)}
        <a class="page-tree-link" href="${contentPath(context.spaceId, item.id)}" ${current ? html`aria-current="page"` : ''}>
          <span class="tree-kind" aria-hidden="true">${icon(glyph, 16)}</span><span class="tree-title">${item.title}</span></a>
        ${context.canWrite ? actions(item) : ''}
      </div>
      ${expanded ? html`<ul role="group">${item.children.map((child) => row(child, context, open))}</ul>` : ''}
    </li>
  `
}

/** The folders open in the tree: all but the folded ones, always the path to the current item. */
const openIds = (context: TreeContext): Set<string> => {
  const closed = context.searching ? new Set<string>() : new Set(folded.get())
  const open = new Set(context.shown.map((node) => node.id).filter((id) => !closed.has(id)))
  for (const ancestor of context.currentId ? ancestorsOf(context.nodes, context.currentId) : []) {
    open.add(ancestor.id)
  }
  return open
}

/** A LET’S Draw AI space's content (escopo-mvp 5.1): folders, pages and whiteboards, as a tree. */
export const contentTree = (context: TreeContext): Html =>
  context.shown.length
    ? html`<ul role="tree" aria-label="Conteúdo" class="content-tree">${buildTree(context.shown).map((item) => row(item, context, openIds(context)))}</ul>`
    : html`<p class="muted page-tree-empty">${context.nodes.length ? 'Nada encontrado.' : 'Nenhum conteúdo ainda.'}</p>`

const remove = (context: TreeContext, contentId: string) => {
  const node = context.nodes.find((each) => each.id === contentId)
  if (!node || !confirm(`Excluir "${node.title}"?`)) {
    return
  }
  drawWrite
    .remove({ id: contentId, spaceId: context.spaceId })
    .then(() => (contentId === context.currentId ? navigate(drawSpacePath(context.spaceId)) : undefined))
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
}

const TREE_ACTIONS: Record<string, (context: TreeContext, target: HTMLElement, redraw: () => void) => void> = {
  'data-add-inside': (context, target) =>
    openCreateMenu(target, { spaceId: context.spaceId, parentId: target.dataset.addInside }),
  'data-delete-content': (context, target) => remove(context, target.dataset.deleteContent ?? ''),
  'data-fold': (_context, target, redraw) => {
    const id = target.dataset.fold ?? ''
    const closed = new Set(folded.get())
    closed.has(id) ? closed.delete(id) : closed.add(id)
    folded.set([...closed])
    redraw()
  }
}

/** Clicks and drags on the tree, delegated from its host, so a redraw of the tree keeps them. */
export const bindContentTree = (host: HTMLElement, context: () => TreeContext, redraw: () => void): void => {
  host.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-add-inside], [data-delete-content], [data-fold]'
    )
    const action = Object.entries(TREE_ACTIONS).find(([attribute]) => target?.hasAttribute(attribute))
    if (target && action) {
      event.preventDefault()
      action[1](context(), target, redraw)
    }
  })
  bindDrag(host, context)
}

/** The top quarter of a row drops before it, the bottom quarter after it, the middle inside it. */
const zoneOf = (row: HTMLElement, y: number): DropZone => {
  const box = row.getBoundingClientRect()
  const at = (y - box.top) / box.height
  if (at < 0.25) {
    return 'before'
  }
  return at > 0.75 ? 'after' : 'inside'
}

const clear = (host: HTMLElement) => {
  for (const each of host.querySelectorAll('.drop-before, .drop-inside, .drop-after')) {
    each.classList.remove('drop-before', 'drop-inside', 'drop-after')
  }
}

const bindDrag = (host: HTMLElement, context: () => TreeContext): void => {
  let dragged: string | undefined
  host.addEventListener('dragstart', (event) => {
    dragged = (event.target as HTMLElement).closest<HTMLElement>('[data-content-id]')?.dataset.contentId
    event.dataTransfer?.setData('text/plain', dragged ?? '')
  })
  host.addEventListener('dragover', (event) => {
    const over = (event.target as HTMLElement).closest<HTMLElement>('.page-tree-row')
    if (over && dragged) {
      event.preventDefault()
      clear(host)
      over.classList.add(`drop-${zoneOf(over, event.clientY)}`)
    }
  })
  host.addEventListener('dragend', () => clear(host))
  host.addEventListener('drop', (event) => {
    event.preventDefault()
    const over = (event.target as HTMLElement).closest<HTMLElement>('.page-tree-row')
    const targetId = over?.closest<HTMLElement>('[data-content-id]')?.dataset.contentId
    clear(host)
    const { nodes, spaceId } = context()
    const place =
      dragged && targetId && over ? dropTarget(nodes, dragged, targetId, zoneOf(over, event.clientY)) : undefined
    if (dragged && place) {
      drawWrite
        .move({ id: dragged, spaceId }, place.parentId, place.index)
        .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
    }
  })
}

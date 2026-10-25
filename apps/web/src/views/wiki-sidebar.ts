import { type ContentNode, drawRead } from '@/api/draw'
import { read } from '@/api/requests'
import { type Collection, type WikiLine, wikiRead } from '@/api/wiki'
import { ancestorsOf, filterTree } from '@/lib/content-tree'
import { type Html, html } from '@/lib/html'
import { persistedStore } from '@/lib/store'
import { collectionPath, WIKI_COLLECTIONS, WIKI_HOME, WIKI_REVIEWS, wikiPagePath } from '@/lib/wiki'
import { firstRoots, SECTION_LIMIT, sliceSection } from '@/lib/wiki-nav'
import { bindContentTree, contentTree, type TreeContext } from '@/ui/content-tree'
import { openCreateMenu } from '@/ui/create-menu'
import { type IconName, icon } from '@/ui/icons'
import { openCreateCollection, openNewPage } from '@/ui/wiki-dialogs'
import { glyph, lockOf } from '@/ui/wiki-marks'

import { navItem, productLink } from './shell'

/**
 * LET’S Wiki's sidebar (wiki-navegacao.md, "Barra lateral"): "Nova página", home and every collection,
 * then four sections that fold — Coleções, each expanding into its tree; Favoritas; Compartilhadas
 * comigo; Privadas — and the caller's reviews.
 */

type SectionKey = 'collections' | 'favorites' | 'shared' | 'private'

/** The sections folded, and the collections expanded, per viewer, on this browser. */
const closedSections = persistedStore<string[]>('jiraia.wiki.closed-sections', [])
const openCollections = persistedStore<string[]>('jiraia.wiki.open-collections', [])

/** The sections showing everything, past their first eight — until the panel reloads. */
const showingAll = new Set<SectionKey>()

/** What the sidebar drew last, for its bind: each tree on screen, and where "Nova página" points. */
let drawn: {
  trees: Map<string, TreeContext>
  collections: Collection[]
  suggested?: string | undefined
  privateTree?: TreeContext
} = {
  trees: new Map(),
  collections: []
}

/** The ways to the other products, at the foot of every LET’S Wiki sidebar (ADR-0010). */
const back = html`<hr class="nav-divider" />${productLink('/', 'JiraIA', 'kanban')}${productLink('/draw', 'LET’S Draw AI', 'notebook')}`

const toggleButton = (key: SectionKey, title: string, open: boolean): Html =>
  html`<button type="button" class="nav-toggle" data-toggle-section="${key}" aria-expanded="${open}" aria-controls="wiki-section-${key}" aria-label="${open ? 'Recolher' : 'Expandir'} ${title}">${icon('chevronRight', 14)}</button>`

/** A section that folds: its title, its actions, and what it holds. */
const section = (key: SectionKey, title: string, glyphName: IconName, body: Html, actions: Html = html``): Html => {
  const open = !closedSections.get().includes(key)
  return html`
    <div class="nav-group wiki-section" data-section="${key}">
      <div class="nav-group-head">
        <button type="button" class="nav-group-label" data-toggle-section="${key}" title="${title}">${icon(glyphName)}<span class="nav-label">${title}</span></button>
        <span class="nav-group-actions">${actions}${toggleButton(key, title, open)}</span>
      </div>
      <div id="wiki-section-${key}" class="nav-tree" role="group" aria-label="${title}" ${open ? '' : html`hidden`}>${body}</div>
    </div>
  `
}

const more = (key: SectionKey, count: number): Html =>
  html`<button type="button" class="nav-more" data-show-all="${key}">Ver todas (${count + SECTION_LIMIT})</button>`

/** The first eight of a list, the rest folded behind "Ver todas"; nothing in it is said in one quiet line. */
const listBody = (key: SectionKey, items: readonly Html[], empty: string): Html => {
  if (items.length === 0) {
    return html`<div class="nav-sub"><p class="nav-sub-empty">${empty}</p></div>`
  }
  const { shown, rest } = sliceSection(items, showingAll.has(key) ? items.length : SECTION_LIMIT)
  return html`<div class="nav-sub">${shown}${rest.length ? html`<div class="nav-rest" data-rest="${key}" hidden>${rest}</div>${more(key, rest.length)}` : ''}</div>`
}

const pageLink = (item: WikiLine, path: string): Html => {
  const href = wikiPagePath(item.collectionId, item.contentId)
  return html`<a class="nav-sub-item wiki-nav-line ${path === href ? 'is-active' : ''}" href="${href}" title="${item.title} · ${item.collectionName}" ${path === href ? html`aria-current="page"` : ''}>
    ${glyph(item, 14)}<span class="draw-space-label">${item.title}</span></a>`
}

const treeContext = (collection: Collection, nodes: readonly ContentNode[], currentId?: string): TreeContext => ({
  spaceId: collection.id,
  nodes,
  shown: filterTree(nodes, '', new Set()),
  currentId,
  searching: false,
  canWrite: collection.canWrite,
  area: 'wiki'
})

/** A collection in the list: the arrow expands its tree right there, "+" makes a page in it. */
const collectionRow = (collection: Collection, path: string, expanded: boolean): Html => {
  const href = collectionPath(collection.id)
  const active = path === href || path.startsWith(`${href}/`)
  const tree = drawn.trees.get(collection.id)
  return html`<div class="wiki-collection" data-collection="${collection.id}">
    <div class="draw-space-row ${active ? 'is-active' : ''}">
      <button type="button" class="page-tree-toggle wiki-expand" data-expand-collection="${collection.id}" aria-expanded="${expanded}" aria-label="${expanded ? 'Recolher' : 'Expandir'} ${collection.name}">${icon('chevronRight', 14)}</button>
      <a class="nav-sub-item draw-space" href="${href}" ${path === href ? html`aria-current="page"` : ''}>
        <span class="draw-space-icon" aria-hidden="true">${collection.icon}</span><span class="draw-space-label">${collection.name}</span>${lockOf(collection.access)}</a>
      ${collection.canWrite ? html`<button type="button" class="nav-action" data-new-in="${collection.id}" aria-label="Nova página em ${collection.name}" title="Nova página">${icon('plus', 14)}</button>` : ''}
    </div>
    <div class="wiki-collection-tree" data-tree-host="${collection.id}" ${expanded ? '' : html`hidden`}>${expanded && tree ? contentTree(tree) : ''}</div>
  </div>`
}

const expandedIds = (open?: string): Set<string> => new Set([...openCollections.get(), ...(open ? [open] : [])])

/** The trees to draw: the collections expanded, and the one open on screen down to its page. */
const loadTrees = async (collections: readonly Collection[], open?: string, currentId?: string) => {
  const expanded = expandedIds(open)
  const shown = collections.filter((each) => expanded.has(each.id))
  const trees = await Promise.all(shown.map((each) => drawRead.tree(each.id)))
  return new Map(
    shown.map((each, index) => [
      each.id,
      treeContext(each, trees[index]?.items ?? [], each.id === open ? currentId : undefined)
    ])
  )
}

const collectionsSection = (
  collections: readonly Collection[],
  path: string,
  open: string | undefined,
  creates: boolean
) => {
  const expanded = expandedIds(open)
  if (collections.findIndex((each) => each.id === open) >= SECTION_LIMIT) {
    showingAll.add('collections')
  }
  const rows = collections.map((each) => collectionRow(each, path, expanded.has(each.id)))
  const actions = creates
    ? html`<button type="button" class="nav-action" data-new-collection aria-label="Criar coleção" title="Criar coleção">${icon('plus', 16)}</button>`
    : html``
  return section(
    'collections',
    'Coleções',
    'books',
    listBody('collections', rows, 'Nenhuma coleção que você leia ainda.'),
    actions
  )
}

/** "Privadas": the caller's personal collection, as a tree; its first eight pages, then "Ver todas". */
const privateSection = (personal: Collection, tree: TreeContext): Html => {
  const roots = tree.nodes.filter((node) => node.parentId === null).length
  const inside = tree.currentId ? ancestorsOf(tree.nodes, tree.currentId).length > 0 : false
  const all = showingAll.has('private') || inside || roots <= SECTION_LIMIT
  const context = all ? tree : { ...tree, shown: firstRoots(tree.shown) }
  drawn.trees.set(personal.id, context)
  drawn.privateTree = tree
  const body = roots
    ? html`<div class="wiki-private-tree" data-tree-host="${personal.id}">${contentTree(context)}</div>${all ? '' : more('private', roots - SECTION_LIMIT)}`
    : html`<div class="nav-sub"><p class="nav-sub-empty">Rascunhos e notas só seus. Ninguém mais vê o que estiver aqui.</p></div>`
  const actions = html`<button type="button" class="nav-action" data-new-in="${personal.id}" aria-label="Nova página privada" title="Nova página privada">${icon('plus', 16)}</button>`
  return section('private', 'Privadas', 'lock', body, actions)
}

const loadSidebar = async (collectionId?: string, currentId?: string) => {
  const [me, list, reviews, favorites, shared, personal] = await Promise.all([
    read.me(),
    wikiRead.collections(),
    wikiRead.reviews(),
    wikiRead.favorites(),
    wikiRead.shared(),
    wikiRead.personal()
  ])
  const [trees, personalTree] = await Promise.all([
    loadTrees(list.items, collectionId, currentId),
    drawRead.tree(personal.id)
  ])
  return { me, list, reviews, favorites, shared, personal, trees, personalTree, currentId }
}

/** Where "Nova página" points: the collection open, if the caller writes in it, or their personal one. */
const suggestedFor = (collections: readonly Collection[], personal: Collection, collectionId?: string) =>
  collections.find((each) => each.id === collectionId && each.canWrite)?.id ?? personal.id

/** A section listing pages of any collection: Favoritas or Compartilhadas comigo. */
const linesSection = (key: 'favorites' | 'shared', items: readonly WikiLine[], path: string): Html => {
  const { title, glyphName, empty } = LINE_SECTIONS[key]
  const body = listBody(
    key,
    items.map((item) => pageLink(item, path)),
    empty
  )
  return section(key, title, glyphName, body)
}

const LINE_SECTIONS = {
  favorites: { title: 'Favoritas', glyphName: 'star', empty: 'Marque páginas com estrela para achá-las aqui.' },
  shared: {
    title: 'Compartilhadas comigo',
    glyphName: 'users',
    empty: 'Páginas pessoais de outras pessoas em que você recebeu papel aparecem aqui.'
  }
} as const

const newPageButton = html`<button type="button" class="button button-primary wiki-new-page" data-wiki-new-page title="Nova página">${icon('plus', 16)}<span class="nav-label">Nova página</span></button>`

export const wikiSidebar = async (path: string, collectionId?: string, currentId?: string): Promise<Html> => {
  const data = await loadSidebar(collectionId, currentId)
  const { personal } = data
  drawn = {
    trees: data.trees,
    collections: [...data.list.items, personal],
    suggested: suggestedFor(data.list.items, personal, collectionId)
  }
  const current = personal.id === collectionId ? currentId : undefined
  return html`
    ${newPageButton}
    ${navItem(WIKI_HOME, 'Início', 'home', path)}
    ${navItem(WIKI_COLLECTIONS, 'Todas as coleções', 'layoutGrid', path)}
    ${collectionsSection(data.list.items, path, collectionId, data.me.isOrgAdmin)}
    ${linesSection('favorites', data.favorites.items, path)}
    ${linesSection('shared', data.shared.items, path)}
    ${privateSection(personal, treeContext(personal, data.personalTree.items, current))}
    ${navItem(WIKI_REVIEWS, 'Revisões', 'calendarCheck', path, data.reviews.items.length)}
    ${back}
  `
}

/** Folding a section: the arrow turns, the body hides, and the choice is kept for next time. */
const toggleSection = (sidebar: HTMLElement, key: string): void => {
  const closed = new Set(closedSections.get())
  const open = closed.has(key)
  open ? closed.delete(key) : closed.add(key)
  closedSections.set([...closed])
  sidebar.querySelector(`#wiki-section-${key}`)?.toggleAttribute('hidden', !open)
  const arrow = sidebar.querySelector<HTMLElement>(`.nav-toggle[data-toggle-section="${key}"]`)
  arrow?.setAttribute('aria-expanded', String(open))
}

const showAll = (sidebar: HTMLElement, button: HTMLElement): void => {
  const key = button.dataset.showAll as SectionKey
  showingAll.add(key)
  sidebar.querySelector<HTMLElement>(`[data-rest="${key}"]`)?.removeAttribute('hidden')
  if (key === 'private' && drawn.privateTree) {
    drawn.trees.set(drawn.privateTree.spaceId, drawn.privateTree)
    redrawTree(sidebar.querySelector<HTMLElement>('.wiki-private-tree'))
  }
  button.remove()
}

const redrawTree = (host: HTMLElement | null | undefined): void => {
  const context = host ? drawn.trees.get(host.dataset.treeHost ?? '') : undefined
  if (host && context) {
    host.innerHTML = contentTree(context).value
  }
}

/** A tree's own clicks — folding, creating inside, deleting, dragging — once per host. */
const bindTree = (host: HTMLElement): void => {
  if (host.dataset.bound !== undefined) {
    return
  }
  host.dataset.bound = ''
  const id = host.dataset.treeHost ?? ''
  bindContentTree(
    host,
    () => drawn.trees.get(id) as TreeContext,
    () => redrawTree(host)
  )
}

/** Expanding a collection loads its tree into the row; the choice is kept for next time. */
const expandCollection = async (sidebar: HTMLElement, button: HTMLElement): Promise<void> => {
  const id = button.dataset.expandCollection ?? ''
  const host = sidebar.querySelector<HTMLElement>(`[data-tree-host="${id}"]`)
  const open = button.getAttribute('aria-expanded') !== 'true'
  const kept = new Set(openCollections.get())
  open ? kept.add(id) : kept.delete(id)
  openCollections.set([...kept])
  button.setAttribute('aria-expanded', String(open))
  const collection = drawn.collections.find((each) => each.id === id)
  if (open && collection && !drawn.trees.has(id)) {
    drawn.trees.set(id, treeContext(collection, (await drawRead.tree(id)).items))
  }
  redrawTree(host)
  host?.toggleAttribute('hidden', !open)
  if (host) {
    bindTree(host)
  }
}

const newIn = (button: HTMLElement): void => {
  const collection = drawn.collections.find((each) => each.id === button.dataset.newIn)
  if (collection) {
    openCreateMenu(button, { spaceId: collection.id, area: 'wiki', outline: collection.outline })
  }
}

const SIDEBAR_ACTIONS: Record<string, (sidebar: HTMLElement, target: HTMLElement) => void> = {
  'data-toggle-section': (sidebar, target) => toggleSection(sidebar, target.dataset.toggleSection ?? ''),
  'data-show-all': (sidebar, target) => showAll(sidebar, target),
  'data-expand-collection': (sidebar, target) => void expandCollection(sidebar, target),
  'data-new-collection': () => openCreateCollection(),
  'data-wiki-new-page': () => void openNewPage({ collectionId: drawn.suggested }),
  'data-new-in': (_sidebar, target) => newIn(target)
}

const SELECTOR = Object.keys(SIDEBAR_ACTIONS)
  .map((attribute) => `[${attribute}]`)
  .join(', ')

export const bindWikiSidebar = (sidebar: HTMLElement): void => {
  sidebar.addEventListener('click', (event) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>(SELECTOR)
    const action = Object.entries(SIDEBAR_ACTIONS).find(([attribute]) => target?.hasAttribute(attribute))
    if (target && action) {
      event.preventDefault()
      action[1](sidebar, target)
    }
  })
  for (const host of sidebar.querySelectorAll<HTMLElement>('[data-tree-host]:not([hidden])')) {
    bindTree(host)
  }
}

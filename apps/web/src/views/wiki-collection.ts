import { drawWrite } from '@/api/draw'
import { read } from '@/api/requests'
import { type Collection, type WikiNode, wikiRead, wikiWrite } from '@/api/wiki'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { collectionPath, wikiPagePath } from '@/lib/wiki'
import {
  childrenOf,
  filtering,
  filterPages,
  type PageFilter,
  relativeTime,
  STATE_FILTERS,
  type StateFilter,
  subpageCounts
} from '@/lib/wiki-nav'
import { accessPanel, bindAccessPanel } from '@/ui/access-panel'
import { openCreateMenu } from '@/ui/create-menu'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'
import { openChangeOwner, openCollectionSettings } from '@/ui/wiki-dialogs'
import { accessBadge, copyLink, glyph, mark, person } from '@/ui/wiki-marks'

import type { View } from './view'
import { bindWikiSidebar, wikiSidebar } from './wiki-sidebar'

/**
 * A collection (wiki-navegacao.md, "Coleção"): its header — access, review period, search, filter and
 * "Nova página" — and its pages as a table, each expanding into its subpages.
 */

/** What render read, for bind and for the table's own redraws. */
/** A page of the table, knowing its collection for its address. */
type Page = WikiNode & { spaceId: string }
type Shown = { collection: Collection; nodes: Page[]; favorites: Set<string>; meId: string }
let shown: Shown | undefined

/** The filter and the rows expanded, per collection, while the panel is open. */
const filters = new Map<string, PageFilter>()
const expanded = new Set<string>()

const filterOf = (collectionId: string): PageFilter => {
  const existing = filters.get(collectionId)
  if (existing) {
    return existing
  }
  const created: PageFilter = { text: '', state: 'all' }
  filters.set(collectionId, created)
  return created
}

const toggle = (node: WikiNode, count: number): Html =>
  count > 0
    ? html`<button type="button" class="page-tree-toggle wiki-expand" data-expand-row="${node.id}" aria-expanded="${expanded.has(node.id)}" aria-label="${expanded.has(node.id) ? 'Recolher' : 'Expandir'} ${node.title}">${icon('chevronRight', 14)}</button>`
    : html`<span class="page-tree-toggle" aria-hidden="true"></span>`

const rowMenu = (node: WikiNode): Html =>
  html`<button type="button" class="button button-ghost button-icon" data-row-menu="${node.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações de ${node.title}" title="Mais ações">${icon('dots', 16)}</button>`

const pageRow = (node: Page, depth: number, counts: Map<string, number>, tree: boolean): Html => {
  const href = wikiPagePath(node.spaceId, node.id)
  return html`
    <tr class="wiki-row" data-href="${href}">
      <td class="wiki-cell-name"><span class="wiki-page-name" style="--depth: ${depth}">
        ${tree ? toggle(node, counts.get(node.id) ?? 0) : ''}
        <a class="wiki-row-link" href="${href}">${glyph(node)}<span class="wiki-row-title">${node.title}</span></a></span></td>
      <td class="wiki-cell-state">${node.kind === 'folder' ? html`<span class="muted">Pasta</span>` : mark(node)}</td>
      <td class="wiki-cell-owners">${node.kind === 'folder' ? '' : person(node.owner)}</td>
      <td class="wiki-cell-subpages"><span class="wiki-number">${counts.get(node.id) ?? 0}</span></td>
      <td class="wiki-cell-when"><time datetime="${node.updatedAt}" title="Última edição">${relativeTime(node.updatedAt)}</time></td>
      <td class="actions">${rowMenu(node)}</td>
    </tr>
  `
}

/** The first level, and under each expanded page its own pages, one level deeper. */
const treeRows = (nodes: readonly Page[], parentId: string | null, depth: number, counts: Map<string, number>) =>
  childrenOf(nodes, parentId).map(
    (node): Html =>
      html`${pageRow(node, depth, counts, true)}${expanded.has(node.id) ? treeRows(nodes, node.id, depth + 1, counts) : ''}`
  )

const tableRows = (data: Shown, filter: PageFilter): Html[] => {
  const counts = subpageCounts(data.nodes)
  return filtering(filter)
    ? filterPages(data.nodes, filter).map((node) => pageRow(node, 0, counts, false))
    : treeRows(data.nodes, null, 0, counts)
}

const emptyText = (data: Shown, filter: PageFilter): string => {
  if (filtering(filter)) {
    return 'Nenhuma página com esse filtro.'
  }
  return data.collection.canWrite ? 'A coleção está vazia. Crie a primeira página.' : 'A coleção está vazia.'
}

/** The pages table — or, with nothing to show, one line that says why. */
const pagesTable = (data: Shown): Html => {
  const filter = filterOf(data.collection.id)
  const rows = tableRows(data, filter)
  return rows.length
    ? html`<table class="table wiki-table wiki-pages-table">
        <thead><tr><th class="wiki-cell-name">Página</th><th class="wiki-cell-state">Estado</th><th class="wiki-cell-owners">Responsável</th><th class="wiki-cell-subpages">Subpáginas</th><th class="wiki-cell-when">Última atividade</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${rows}</tbody></table>`
    : html`<p class="empty muted">${emptyText(data, filter)}</p>`
}

const headerTools = (collection: Collection, filter: PageFilter): Html => html`
  <div class="wiki-tools">
    <label class="wiki-search"><span class="sr-only">Buscar páginas da coleção</span>${icon('search', 16)}
      <input type="search" class="input" data-page-search placeholder="Buscar página" value="${filter.text}" autocomplete="off" /></label>
    <button type="button" class="button button-ghost ${filter.state !== 'all' || filter.ownerId ? 'is-on' : ''}" data-page-filter aria-haspopup="true" aria-expanded="false">${icon('filter', 16)}Filtrar</button>
    ${collection.canWrite ? html`<button type="button" class="button button-primary" data-new-page>${icon('plus', 16)}Nova página${icon('chevronDown', 14)}</button>` : ''}
    ${collection.canManage ? html`<button type="button" class="button button-ghost button-icon" data-collection-menu aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações da coleção" title="Mais ações">${icon('dots', 16)}</button>` : ''}
  </div>
`

const meta = (collection: Collection): Html => html`
  <p class="muted wiki-meta">${collection.access === 'personal' ? 'Rascunhos e notas só seus — publique numa coleção para virar oficial.' : `Revisão das páginas oficiais a cada ${collection.reviewDays} dias`}${collection.outline === 'customer' ? ' · Páginas novas começam pela ficha de cliente' : ''}</p>
`

const header = (collection: Collection, people: boolean): Html => html`
  <header class="page-header wiki-collection-head">
    <div class="wiki-collection-title">
      <span class="wiki-collection-icon" aria-hidden="true">${collection.icon}</span>
      <div class="wiki-collection-text"><div class="row wiki-head"><h1>${collection.name}</h1>${accessBadge(collection.access)}</div>
        ${collection.description ? html`<p class="muted">${collection.description}</p>` : ''}${meta(collection)}</div>
    </div>
    ${people ? html`<a class="button button-ghost" href="${collectionPath(collection.id)}">${icon('chevronLeft', 16)}Páginas</a>` : headerTools(collection, filterOf(collection.id))}
  </header>
`

/** `?aba=pessoas` shows who holds a role in the collection — owners, editors and, if restricted, readers. */
const peopleTab = (): boolean => new URLSearchParams(location.search).get('aba') === 'pessoas'

const PEOPLE_NOTE: Record<Collection['access'], string> = {
  organization: 'Toda a LET’S lê. Administradores são os donos: tornam páginas oficiais. Membros editam.',
  restricted: 'Só quem está aqui lê. Administradores são os donos; membros editam; leitores só leem.',
  personal: 'Só você e quem você incluir aqui. Membros editam; leitores só leem.'
}

const peopleScreen = async (collection: Collection): Promise<Html> =>
  html`<h2 class="section-title">Pessoas e papéis</h2><p class="muted">${PEOPLE_NOTE[collection.access]}</p>${await accessPanel('draw', collection.id)}`

export const wikiCollectionView: View = {
  path: '/wiki/:collectionId',
  title: 'Coleção',
  area: 'wiki',
  sidebar: async ({ collectionId = '' }) => await wikiSidebar(collectionPath(collectionId), collectionId),
  bindSidebar: (sidebar) => bindWikiSidebar(sidebar),
  render: async ({ collectionId = '' }) => {
    const [me, collection, tree, favorites] = await Promise.all([
      read.me(),
      wikiRead.collection(collectionId),
      wikiRead.tree(collectionId),
      wikiRead.favorites()
    ])
    const nodes = tree.items.map((node) => ({ ...node, spaceId: collection.id }))
    shown = { collection, nodes, favorites: new Set(favorites.items.map((each) => each.contentId)), meId: me.id }
    const people = peopleTab()
    return html`${header(collection, people)}${people ? await peopleScreen(collection) : html`<div data-pages-host>${pagesTable(shown)}</div>`}`
  },
  bind: (root, { collectionId = '' }) => {
    if (peopleTab()) {
      bindAccessPanel(root, 'draw', collectionId)
      return
    }
    if (shown) {
      bindCollection(root, shown)
    }
  }
}

const redrawTable = (root: HTMLElement, data: Shown): void => {
  const host = root.querySelector<HTMLElement>('[data-pages-host]')
  if (host) {
    host.innerHTML = pagesTable(data).value
  }
}

const filterMenu = (filter: PageFilter): Html => html`
  <p class="draw-menu-title">Estado</p>
  ${STATE_FILTERS.map(
    (each) =>
      html`<button type="button" class="chip chip-toggle" data-state-filter="${each.value}" aria-pressed="${filter.state === each.value}">${each.label}</button>`
  )}
  <p class="draw-menu-title">Responsável</p>
  <button type="button" class="chip chip-toggle" data-mine-filter aria-pressed="${Boolean(filter.ownerId)}">Só as minhas</button>
`

/** Choosing in the filter changes the table at once and keeps the menu open for the next choice. */
const onFilter = (root: HTMLElement, data: Shown, button: HTMLElement, target: HTMLElement): boolean => {
  const filter = filterOf(data.collection.id)
  const state = target.closest<HTMLElement>('[data-state-filter]')?.dataset.stateFilter as StateFilter | undefined
  if (state) {
    filter.state = state
  } else if (target.closest('[data-mine-filter]')) {
    filter.ownerId = filter.ownerId ? undefined : data.meId
  }
  const menu = target.closest<HTMLElement>('.floating-menu')
  if (menu) {
    menu.innerHTML = filterMenu(filter).value
  }
  button.classList.toggle('is-on', filter.state !== 'all' || Boolean(filter.ownerId))
  redrawTable(root, data)
  return true
}

const openFilter = (root: HTMLElement, data: Shown, button: HTMLElement): void =>
  toggleFloatingMenu({
    anchor: button,
    label: 'Filtrar páginas',
    className: 'draw-menu draw-filter-menu wiki-filter-menu',
    role: 'group',
    placement: 'bottom-end',
    content: filterMenu(filterOf(data.collection.id)),
    onClick: (target) => onFilter(root, data, button, target)
  })

const COLLECTION_MENU = html`
  <button type="button" role="menuitem" data-collection-action="settings">${icon('settings', 16)}Configurações</button>
  <button type="button" role="menuitem" data-collection-action="people">${icon('users', 16)}Pessoas e papéis</button>
`

const openCollectionMenu = (data: Shown, button: HTMLElement): void =>
  toggleFloatingMenu({
    anchor: button,
    label: 'Ações da coleção',
    className: 'draw-menu',
    placement: 'bottom-end',
    content: COLLECTION_MENU,
    onClick: (target) => {
      const action = target.closest<HTMLElement>('[data-collection-action]')?.dataset.collectionAction
      if (action === 'settings') {
        openCollectionSettings(data.collection)
      } else if (action === 'people') {
        navigate(`${collectionPath(data.collection.id)}?aba=pessoas`)
      }
      return action === undefined
    }
  })

const menuItem = (action: string, glyphName: Parameters<typeof icon>[0], label: string): Html =>
  html`<button type="button" role="menuitem" data-row-action="${action}">${icon(glyphName, 16)}${label}</button>`

const favoriteItem = (favorite: boolean): Html =>
  menuItem('favorite', favorite ? 'starFilled' : 'star', favorite ? 'Tirar das favoritas' : 'Favoritar')

/** What a row's menu offers: by the kind of row and the caller's role. */
const rowActions = (data: Shown, node: WikiNode): Html => {
  const page = node.kind !== 'folder'
  const hands = page && (data.collection.canManage || node.owner.id === data.meId)
  return html`
    ${page ? favoriteItem(data.favorites.has(node.id)) : ''}
    ${menuItem('link', 'link', 'Copiar link')}
    ${hands ? menuItem('owner', 'user', 'Trocar responsável') : ''}
    ${data.collection.canWrite ? menuItem('delete', 'trash', 'Excluir') : ''}
  `
}

const ROW_ACTIONS: Record<string, (data: Shown, node: WikiNode) => Promise<unknown> | undefined> = {
  favorite: (data, node) =>
    wikiWrite.setFavorite({ contentId: node.id, collectionId: data.collection.id }, !data.favorites.has(node.id)),
  link: (data, node) => {
    copyLink(wikiPagePath(data.collection.id, node.id))
    return undefined
  },
  owner: (data, node) =>
    read
      .members()
      .then((members) =>
        openChangeOwner({ contentId: node.id, collectionId: data.collection.id, owner: node.owner }, members.items)
      ),
  delete: (data, node) =>
    confirm(`Excluir "${node.title}"?`) ? drawWrite.remove({ id: node.id, spaceId: data.collection.id }) : undefined
}

const openRowMenu = (data: Shown, button: HTMLElement): void => {
  const node = data.nodes.find((each) => each.id === button.dataset.rowMenu)
  if (!node) {
    return
  }
  toggleFloatingMenu({
    anchor: button,
    label: `Ações de ${node.title}`,
    className: 'draw-menu',
    placement: 'bottom-end',
    content: rowActions(data, node),
    onClick: (target) => {
      const action = target.closest<HTMLElement>('[data-row-action]')?.dataset.rowAction
      void Promise.resolve(action ? ROW_ACTIONS[action]?.(data, node) : undefined).catch((refusal: unknown) =>
        toast(refusalSentence(refusal), 'error')
      )
      return action === undefined
    }
  })
}

const toggleRow = (root: HTMLElement, data: Shown, button: HTMLElement): void => {
  const id = button.dataset.expandRow ?? ''
  expanded.has(id) ? expanded.delete(id) : expanded.add(id)
  redrawTable(root, data)
}

/** Clicks on the table: expand a row, open its menu — or, anywhere else on it, open the page. */
const onTableClick = (root: HTMLElement, data: Shown, target: HTMLElement): void => {
  const fold = target.closest<HTMLElement>('[data-expand-row]')
  const menu = target.closest<HTMLElement>('[data-row-menu]')
  const row = target.closest<HTMLElement>('[data-href]')
  if (fold) {
    toggleRow(root, data, fold)
  } else if (menu) {
    openRowMenu(data, menu)
  } else if (row && !target.closest('a')) {
    navigate(row.dataset.href ?? '')
  }
}

const bindCollection = (root: HTMLElement, data: Shown): void => {
  root.querySelector('[data-pages-host]')?.addEventListener('click', (event) => {
    onTableClick(root, data, event.target as HTMLElement)
  })
  root.querySelector<HTMLInputElement>('[data-page-search]')?.addEventListener('input', (event) => {
    filterOf(data.collection.id).text = (event.target as HTMLInputElement).value
    redrawTable(root, data)
  })
  const filterButton = root.querySelector<HTMLElement>('[data-page-filter]')
  filterButton?.addEventListener('click', () => openFilter(root, data, filterButton))
  const menuButton = root.querySelector<HTMLElement>('[data-collection-menu]')
  menuButton?.addEventListener('click', () => openCollectionMenu(data, menuButton))
  root.querySelector<HTMLElement>('[data-new-page]')?.addEventListener('click', (event) =>
    openCreateMenu(event.currentTarget as HTMLElement, {
      spaceId: data.collection.id,
      area: 'wiki',
      outline: data.collection.outline
    })
  )
}

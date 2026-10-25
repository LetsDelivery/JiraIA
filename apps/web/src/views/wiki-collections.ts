import { read } from '@/api/requests'
import { type Collection, type WikiLine, wikiRead } from '@/api/wiki'
import { type Html, html } from '@/lib/html'
import { navigate } from '@/lib/router'
import { collectionPath, WIKI_COLLECTIONS } from '@/lib/wiki'
import { matchesName } from '@/lib/wiki-nav'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { openCollectionSettings, openCreateCollection } from '@/ui/wiki-dialogs'
import { accessBadge, lineItem, lockOf, person } from '@/ui/wiki-marks'

import type { View } from './view'
import { bindWikiSidebar, wikiSidebar } from './wiki-sidebar'

/**
 * "Todas as coleções" (wiki-navegacao.md): every collection the caller reads, as a table — cards on a
 * phone — with the pages they opened last and their favourites a tab away.
 */

const TABS = [
  { key: 'colecoes', label: 'Coleções' },
  { key: 'recentes', label: 'Recentes' },
  { key: 'favoritas', label: 'Favoritas' }
] as const
type Tab = (typeof TABS)[number]['key']

const tabOf = (): Tab => {
  const asked = new URLSearchParams(location.search).get('aba')
  return TABS.find((each) => each.key === asked)?.key ?? 'colecoes'
}

const tabBar = (current: Tab): Html => html`
  <nav class="tabs wiki-tabs" aria-label="O que listar">
    ${TABS.map(
      (each) =>
        html`<a class="tab" href="${WIKI_COLLECTIONS}${each.key === 'colecoes' ? '' : `?aba=${each.key}`}" ${each.key === current ? html`aria-current="page"` : ''}>${each.label}</a>`
    )}
  </nav>
`

const owners = (collection: Collection): Html => {
  const [first, ...others] = collection.owners
  if (!first) {
    return html`<span class="muted">—</span>`
  }
  return html`${person(first)}${others.length ? html`<span class="muted wiki-more">+${others.length}</span>` : ''}`
}

const officialCell = (collection: Collection): Html => html`
  <span class="wiki-number">${collection.stats.official}</span>
  ${collection.stats.overdue ? html`<span class="badge badge-danger" title="Com a revisão vencida">${collection.stats.overdue} vencida${collection.stats.overdue === 1 ? '' : 's'}</span>` : ''}
`

const peopleCell = (collection: Collection): Html =>
  collection.access === 'organization'
    ? html`<span class="muted">Toda a LET’S</span>`
    : html`<span class="wiki-number">${collection.stats.people}</span>`

const menuButton = (collection: Collection): Html =>
  collection.canManage
    ? html`<button type="button" class="button button-ghost button-icon" data-collection-menu="${collection.id}" aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações de ${collection.name}" title="Mais ações">${icon('dots', 16)}</button>`
    : html``

const collectionRow = (collection: Collection): Html => html`
  <tr class="wiki-row" data-name="${collection.name}" data-href="${collectionPath(collection.id)}">
    <td class="wiki-cell-name"><a class="wiki-row-link" href="${collectionPath(collection.id)}">
      <span class="draw-space-icon draw-space-icon-large" aria-hidden="true">${collection.icon}</span>
      <span class="wiki-row-title">${collection.name}</span>${lockOf(collection.access)}</a></td>
    <td class="wiki-cell-owners">${owners(collection)}</td>
    <td class="wiki-cell-pages"><span class="wiki-number">${collection.stats.pages}</span><span class="wiki-card-unit"> páginas</span></td>
    <td class="wiki-cell-official">${officialCell(collection)}</td>
    <td class="wiki-cell-people">${peopleCell(collection)}</td>
    <td class="wiki-cell-access">${accessBadge(collection.access)}</td>
    <td class="actions">${menuButton(collection)}</td>
  </tr>
`

const collectionsTable = (items: readonly Collection[]): Html =>
  items.length
    ? html`<table class="table wiki-table wiki-collections-table">
        <thead><tr><th class="wiki-cell-name">Coleção</th><th class="wiki-cell-owners">Donos</th><th class="wiki-cell-pages">Páginas</th><th class="wiki-cell-official">Oficiais</th><th class="wiki-cell-people">Pessoas</th><th class="wiki-cell-access">Acesso</th><th><span class="sr-only">Ações</span></th></tr></thead>
        <tbody>${items.map(collectionRow)}</tbody>
      </table>
      <p class="empty muted" data-no-match hidden>Nenhuma coleção com esse nome.</p>`
    : html`<p class="empty muted">Nenhuma coleção que você leia ainda.</p>`

const pageList = (items: readonly WikiLine[], empty: string): Html =>
  items.length
    ? html`<ul class="search-results">${items.map(lineItem)}</ul>
      <p class="empty muted" data-no-match hidden>Nenhuma página com esse título.</p>`
    : html`<p class="empty muted">${empty}</p>`

const TAB_BODY: Record<Tab, () => Promise<Html>> = {
  colecoes: async () => collectionsTable((await wikiRead.collections()).items),
  recentes: async () => pageList((await wikiRead.opened()).items, 'As páginas que você abrir aparecem aqui.'),
  favoritas: async () => pageList((await wikiRead.favorites()).items, 'Marque páginas com estrela para achá-las aqui.')
}

const searchBox = (tab: Tab): Html => html`
  <label class="wiki-search"><span class="sr-only">Buscar por nome</span>${icon('search', 16)}
    <input type="search" class="input" data-name-search placeholder="${tab === 'colecoes' ? 'Buscar coleção' : 'Buscar página'}" autocomplete="off" /></label>
`

export const wikiCollectionsView: View = {
  path: WIKI_COLLECTIONS,
  title: 'Todas as coleções',
  area: 'wiki',
  sidebar: async () => await wikiSidebar(WIKI_COLLECTIONS),
  bindSidebar: (sidebar) => bindWikiSidebar(sidebar),
  render: async () => {
    const tab = tabOf()
    const [me, body] = await Promise.all([read.me(), TAB_BODY[tab]()])
    return html`
      <header class="page-header"><div class="row wiki-head"><h1>Todas as coleções</h1>
        ${me.isOrgAdmin ? html`<button type="button" class="button button-primary wiki-head-action" data-new-collection>${icon('plus', 16)}Criar coleção</button>` : ''}</div>
        <p class="muted">Onde está o conhecimento da LET’S. Coleções restritas aparecem só para quem tem papel nelas.</p></header>
      <div class="wiki-tabs-row">${tabBar(tab)}${searchBox(tab)}</div>
      ${body}
    `
  },
  bind: (root) => {
    root.querySelector('[data-new-collection]')?.addEventListener('click', () => openCreateCollection())
    root.querySelector('[data-name-search]')?.addEventListener('input', (event) => {
      filterByName(root, (event.target as HTMLInputElement).value)
    })
    bindRows(root)
  }
}

/** The search keeps the rows whose name holds what is typed, and says so when none does. */
const filterByName = (root: HTMLElement, query: string): void => {
  const rows = [...root.querySelectorAll<HTMLElement>('[data-name]')]
  for (const row of rows) {
    row.hidden = !matchesName(row.dataset.name ?? '', query)
  }
  root.querySelector<HTMLElement>('[data-no-match]')?.toggleAttribute(
    'hidden',
    rows.some((row) => !row.hidden)
  )
}

const COLLECTION_MENU = html`
  <button type="button" role="menuitem" data-collection-action="settings">${icon('settings', 16)}Configurações</button>
  <button type="button" role="menuitem" data-collection-action="people">${icon('users', 16)}Pessoas e papéis</button>
`

const openCollectionMenu = (button: HTMLElement): void => {
  const id = button.dataset.collectionMenu ?? ''
  toggleFloatingMenu({
    anchor: button,
    label: 'Ações da coleção',
    className: 'draw-menu',
    placement: 'bottom-end',
    content: COLLECTION_MENU,
    onClick: (target) => {
      const action = target.closest<HTMLElement>('[data-collection-action]')?.dataset.collectionAction
      if (action === 'settings') {
        void wikiRead.collection(id).then(openCollectionSettings)
      } else if (action === 'people') {
        navigate(`${collectionPath(id)}?aba=pessoas`)
      }
      return action === undefined
    }
  })
}

/** The whole row opens its collection; its menu button opens the menu instead. */
const bindRows = (root: HTMLElement): void => {
  root.querySelector('.wiki-collections-table')?.addEventListener('click', (event) => {
    const target = event.target as HTMLElement
    const menu = target.closest<HTMLElement>('[data-collection-menu]')
    if (menu) {
      openCollectionMenu(menu)
      return
    }
    const row = target.closest<HTMLElement>('[data-href]')
    if (row && !target.closest('a')) {
      navigate(row.dataset.href ?? '')
    }
  })
}

import { drawRead } from '@/api/draw'
import { read } from '@/api/requests'
import { type Collection, wikiRead } from '@/api/wiki'
import { filterTree } from '@/lib/content-tree'
import { type Html, html } from '@/lib/html'
import { collectionPath, WIKI_HOME, WIKI_REVIEWS } from '@/lib/wiki'
import { bindContentTree, contentTree, type TreeContext } from '@/ui/content-tree'
import { openCreateMenu } from '@/ui/create-menu'
import { icon } from '@/ui/icons'
import { openCreateCollection } from '@/ui/wiki-dialogs'

import { navItem, productLink } from './shell'

/** The ways to the other products, at the foot of every LET’S Wiki sidebar (ADR-0010). */
const back = html`<hr class="nav-divider" />${productLink('/', 'JiraIA', 'kanban')}${productLink('/draw', 'LET’S Draw AI', 'notebook')}`

const collectionLink = (collection: Collection, path: string): Html => {
  const href = collectionPath(collection.id)
  const active = path === href || path.startsWith(`${href}/`)
  return html`<div class="draw-space-row ${active ? 'is-active' : ''}">
    <a class="nav-sub-item draw-space" href="${href}" ${active ? html`aria-current="page"` : ''}>
      <span class="draw-space-icon" aria-hidden="true">${collection.icon}</span><span class="draw-space-label">${collection.name}</span></a>
  </div>`
}

const collections = (items: readonly Collection[], path: string, creates: boolean): Html => html`
  <div class="nav-group">
    <div class="nav-group-head">
      <span class="nav-group-label">${icon('books')}<span class="nav-label">Coleções</span></span>
      ${creates ? html`<span class="nav-group-actions"><button type="button" class="nav-action" data-new-collection aria-label="Criar coleção" title="Criar coleção">${icon('plus', 16)}</button></span>` : ''}
    </div>
    <div class="nav-tree" role="group" aria-label="Coleções"><div class="nav-sub">
      ${items.length ? items.map((each) => collectionLink(each, path)) : html`<p class="nav-sub-empty">Nenhuma coleção ainda.</p>`}
    </div></div>
  </div>
`

/** The sidebar drawn last, for its bind: the collection open, its tree and the page open. */
let drawn: TreeContext | undefined

/**
 * LET’S Wiki's navigation (ADR-0033): home, the caller's reviews, the collections — and, inside one,
 * its pages as a tree, with "Criar" for its editors.
 */
export const wikiSidebar = async (path: string, collectionId?: string, currentId?: string): Promise<Html> => {
  const [me, list, reviews] = await Promise.all([read.me(), wikiRead.collections(), wikiRead.reviews()])
  const open = collectionId ? list.items.find((each) => each.id === collectionId) : undefined
  const nodes = open ? (await drawRead.tree(open.id)).items : []
  drawn = open
    ? {
        spaceId: open.id,
        nodes,
        shown: filterTree(nodes, '', new Set()),
        currentId,
        searching: false,
        canWrite: open.canWrite,
        area: 'wiki'
      }
    : undefined
  return html`
    <p class="nav-title">Navegação</p>
    ${navItem(WIKI_HOME, 'Início', 'home', path)}
    ${navItem(WIKI_REVIEWS, 'Minhas revisões', 'calendarCheck', path, reviews.items.length)}
    ${collections(list.items, path, me.isOrgAdmin)}
    ${
      open && drawn
        ? html`<div class="draw-content-head"><span class="nav-sub-title">${icon('fileText', 14)}Páginas de ${open.name}</span>
            ${open.canWrite ? html`<button type="button" class="nav-action" data-create-wiki-page aria-label="Criar página" title="Criar">${icon('plus', 16)}</button>` : ''}</div>
          <div data-tree-host>${contentTree(drawn)}</div>`
        : ''
    }
    ${back}
  `
}

export const bindWikiSidebar = (sidebar: HTMLElement): void => {
  sidebar.querySelector('[data-new-collection]')?.addEventListener('click', () => openCreateCollection())
  const host = sidebar.querySelector<HTMLElement>('[data-tree-host]')
  const context = drawn
  if (!host || !context) {
    return
  }
  bindContentTree(
    host,
    () => context,
    () => undefined
  )
  sidebar
    .querySelector<HTMLElement>('[data-create-wiki-page]')
    ?.addEventListener('click', (event) =>
      openCreateMenu(event.currentTarget as HTMLElement, { spaceId: context.spaceId, area: 'wiki' })
    )
}

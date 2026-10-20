import { type ContentNode, type DrawSpace, drawRead, drawWrite } from '@/api/draw'
import { read } from '@/api/requests'
import { filterTree } from '@/lib/content-tree'
import { DRAW_HOME, drawSpacePath, KIND_LABEL, type Kind } from '@/lib/draw'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { persistedStore } from '@/lib/store'
import { bindContentTree, contentTree, type TreeContext } from '@/ui/content-tree'
import { openCreateMenu } from '@/ui/create-menu'
import { openCreateDrawSpace, openDrawSpaceSettings } from '@/ui/draw-space-dialogs'
import { toggleFloatingMenu } from '@/ui/floating-menu'
import { icon } from '@/ui/icons'
import { toast } from '@/ui/toast'

import { canCreateSpaces, navItem, productLink } from './shell'

/** Whether "Espaços" is open in LET’S Draw AI's sidebar — per viewer, on this browser. */
const spacesOpen = persistedStore('jiraia.draw.spaces-open', true)

/** The way back to cards, at the foot of every LET’S Draw AI sidebar (ADR-0010). */
const back = html`<hr class="nav-divider" />${productLink('/', 'JiraIA', 'kanban')}`

/**
 * A space in the list. The one open carries its menu — star, follow, settings — so the sidebar names
 * the space once, here, rather than again above its content.
 */
const spaceLink = (space: DrawSpace, path: string): Html => {
  const href = drawSpacePath(space.id)
  const active = path === href || path.startsWith(`${href}/`)
  return html`<div class="draw-space-row ${active ? 'is-active' : ''}">
    <a class="nav-sub-item draw-space" href="${href}" ${active ? html`aria-current="page"` : ''}>
      <span class="draw-space-icon" aria-hidden="true">${space.icon}</span><span class="draw-space-label">${space.name}</span>
      ${space.starred ? html`<span class="draw-space-star" aria-label="Com estrela">${icon('starFilled', 12)}</span>` : ''}</a>
    ${active ? html`<button type="button" class="nav-action" data-space-menu aria-haspopup="menu" aria-expanded="false" aria-label="Mais ações do espaço" title="Mais ações">${icon('dots', 16)}</button>` : ''}
  </div>`
}

/**
 * "Início" and "Espaços", as JiraIA's navigation draws them: "Espaços" is a menu entry like the
 * others, its spaces folded under it, and its actions shown only while it is pointed at (ADR-0011).
 */
const navigation = (spaces: readonly DrawSpace[], path: string, creates: boolean): Html => {
  const open = spacesOpen.get()
  return html`
    <p class="nav-title">Navegação</p>
    ${navItem(DRAW_HOME, 'Início', 'home', path)}
    <div class="nav-group">
      <div class="nav-group-head">
        <button type="button" class="nav-group-label" data-toggle-draw-spaces title="Espaços">${icon('layoutGrid')}<span class="nav-label">Espaços</span></button>
        <span class="nav-group-actions">
          ${creates ? html`<button type="button" class="nav-action" data-new-draw-space aria-label="Criar espaço" title="Criar espaço">${icon('plus', 16)}</button>` : ''}
          <button type="button" class="nav-toggle" data-toggle-draw-spaces aria-expanded="${open}" aria-controls="draw-spaces" aria-label="${open ? 'Recolher' : 'Expandir'} Espaços">${icon('chevronRight', 14)}</button>
        </span>
      </div>
      <div id="draw-spaces" class="nav-tree" role="group" aria-label="Espaços" ${open ? '' : html`hidden`}>
        <div class="nav-sub">
          ${spaces.length ? spaces.map((space) => spaceLink(space, path)) : html`<p class="nav-sub-empty">Nenhum espaço ainda.</p>`}
        </div>
      </div>
    </div>
  `
}

/** The navigation's own clicks: folding "Espaços" and making a new space. */
const bindNavigation = (sidebar: HTMLElement): void => {
  sidebar.querySelector('[data-new-draw-space]')?.addEventListener('click', () => openCreateDrawSpace())
  for (const toggle of sidebar.querySelectorAll('[data-toggle-draw-spaces]')) {
    toggle.addEventListener('click', () => {
      const open = !spacesOpen.get()
      spacesOpen.set(open)
      sidebar.querySelector('#draw-spaces')?.toggleAttribute('hidden', !open)
      const arrow = sidebar.querySelector<HTMLElement>('.nav-toggle[data-toggle-draw-spaces]')
      arrow?.setAttribute('aria-expanded', String(open))
      arrow?.setAttribute('aria-label', `${open ? 'Recolher' : 'Expandir'} Espaços`)
    })
  }
}

/** At home: the navigation, every space under "Espaços" — starred first. */
export const homeSidebar = async (path: string): Promise<Html> => {
  const [me, spaces] = await Promise.all([read.me(), drawRead.spaces()])
  return html`${navigation(spaces.items, path, canCreateSpaces(me))}${back}`
}

export const bindHomeSidebar = (sidebar: HTMLElement): void => bindNavigation(sidebar)

/** What the search box and the filter keep, per space, while the sidebar is redrawn. */
const filters = new Map<string, { text: string; kinds: Set<Kind> }>()
const filterOf = (spaceId: string) => {
  const existing = filters.get(spaceId)
  if (existing) {
    return existing
  }
  const created = { text: '', kinds: new Set<Kind>() }
  filters.set(spaceId, created)
  return created
}

/** The sidebar drawn last, for its bind: the space, its tree and the item open. */
let drawn: { space: DrawSpace; nodes: ContentNode[]; currentId?: string | undefined } | undefined

const treeContext = (): TreeContext => {
  const { space, nodes, currentId } = drawn as NonNullable<typeof drawn>
  const filter = filterOf(space.id)
  return {
    spaceId: space.id,
    nodes,
    currentId,
    shown: filterTree(nodes, filter.text, filter.kinds),
    searching: Boolean(filter.text),
    canWrite: space.canWrite
  }
}

const spaceMenu = (space: DrawSpace): Html => html`
  <button type="button" role="menuitem" data-space-action="star">${icon(space.starred ? 'starFilled' : 'star', 16)}${space.starred ? 'Desmarcar estrela do espaço' : 'Marcar o espaço com estrela'}</button>
  <button type="button" role="menuitem" data-space-action="follow">${icon(space.following ? 'eyeOff' : 'eye', 16)}${space.following ? 'Deixar de seguir o espaço' : 'Seguir o espaço'}</button>
  <button type="button" role="menuitem" data-space-action="people">${icon('users', 16)}Pessoas e papéis</button>
  ${
    space.canManage
      ? html`<p class="draw-menu-title">Ferramentas do espaço</p>
        <button type="button" role="menuitem" data-space-action="settings">${icon('settings', 16)}Configurações do espaço</button>`
      : ''
  }
`

const kindChips = (spaceId: string): Html => {
  const kinds = filterOf(spaceId).kinds
  return html`${(Object.keys(KIND_LABEL) as Kind[]).map(
    (kind) =>
      html`<button type="button" class="chip chip-toggle" data-kind="${kind}" aria-pressed="${kinds.has(kind)}">${KIND_LABEL[kind]}</button>`
  )}`
}

/**
 * Inside a space (ADR-0011), as Confluence lays a space out: the navigation — the space open, with its
 * menu, among the others — then "Conteúdo" with create and filter, a search by title, the tree, and
 * "+ Criar" at its foot.
 */
export const spaceSidebar = async (spaceId: string, currentId?: string): Promise<Html> => {
  const [me, spaces, space, tree] = await Promise.all([
    read.me(),
    drawRead.spaces(),
    drawRead.space(spaceId),
    drawRead.tree(spaceId)
  ])
  drawn = { space, nodes: tree.items, currentId }
  const filtering = filterOf(space.id).kinds.size > 0
  return html`
    ${navigation(spaces.items, drawSpacePath(space.id), canCreateSpaces(me))}
    <div class="draw-content-head">
      <span class="nav-sub-title">${icon('notebook', 14)}Conteúdo</span>
      <span class="row">
        ${space.canWrite ? html`<button type="button" class="nav-action" data-create-content aria-label="Criar conteúdo" title="Criar">${icon('plus', 16)}</button>` : ''}
        <button type="button" class="nav-action ${filtering ? 'is-on' : ''}" data-kind-filter aria-haspopup="true" aria-expanded="false" aria-label="Filtrar conteúdo" title="Filtrar por tipo">${icon('filter', 16)}</button>
      </span>
    </div>
    <label class="draw-search"><span class="sr-only">Pesquisar por título</span>${icon('search', 14)}
      <input type="search" class="input" data-title-search placeholder="Pesquisar por título" value="${filterOf(space.id).text}" /></label>
    <div data-tree-host>${contentTree(treeContext())}</div>
    ${space.canWrite ? html`<button type="button" class="nav-item draw-create" data-create-root>${icon('plus', 16)}<span class="nav-label">Criar</span></button>` : ''}
    ${back}
  `
}

const SPACE_ACTIONS: Record<string, (space: DrawSpace) => Promise<unknown> | undefined> = {
  star: (space) => drawWrite.mark(space.id, 'star', !space.starred),
  follow: (space) =>
    drawWrite
      .mark(space.id, 'follow', !space.following)
      .then(() =>
        toast(
          space.following
            ? 'Você deixou de seguir o espaço.'
            : 'Você segue o espaço: as novidades chegam com as notificações.'
        )
      ),
  settings: (space) => {
    openDrawSpaceSettings(space)
    return undefined
  },
  people: (space) => {
    navigate(`${drawSpacePath(space.id)}?aba=pessoas`)
    return undefined
  }
}

const bindMenus = (sidebar: HTMLElement, space: DrawSpace, redrawTree: () => void): void => {
  const menuButton = sidebar.querySelector<HTMLElement>('[data-space-menu]')
  menuButton?.addEventListener('click', () =>
    toggleFloatingMenu({
      anchor: menuButton,
      label: 'Ações do espaço',
      className: 'draw-menu',
      content: spaceMenu(space),
      onClick: (target) => {
        const action = target.closest<HTMLElement>('[data-space-action]')?.dataset.spaceAction
        void Promise.resolve(action ? SPACE_ACTIONS[action]?.(space) : undefined).catch((refusal: unknown) =>
          toast(refusalSentence(refusal), 'error')
        )
        return action === undefined
      }
    })
  )
  const filterButton = sidebar.querySelector<HTMLElement>('[data-kind-filter]')
  filterButton?.addEventListener('click', () =>
    toggleFloatingMenu({
      anchor: filterButton,
      label: 'Tipos de conteúdo',
      className: 'draw-menu draw-filter-menu',
      role: 'group',
      content: kindChips(space.id),
      onClick: (target) => {
        const chip = target.closest<HTMLElement>('[data-kind]')
        const kind = chip?.dataset.kind as Kind | undefined
        const kinds = filterOf(space.id).kinds
        if (kind) {
          kinds.has(kind) ? kinds.delete(kind) : kinds.add(kind)
          chip?.setAttribute('aria-pressed', String(kinds.has(kind)))
          filterButton.classList.toggle('is-on', kinds.size > 0)
          redrawTree()
        }
        return true
      }
    })
  )
}

export const bindSpaceSidebar = (sidebar: HTMLElement): void => {
  bindNavigation(sidebar)
  if (!drawn) {
    return
  }
  const { space } = drawn
  const host = sidebar.querySelector<HTMLElement>('[data-tree-host]') as HTMLElement
  const redrawTree = () => {
    host.innerHTML = contentTree(treeContext()).value
  }
  bindContentTree(host, treeContext, redrawTree)
  bindMenus(sidebar, space, redrawTree)
  sidebar.querySelector<HTMLInputElement>('[data-title-search]')?.addEventListener('input', (event) => {
    filterOf(space.id).text = (event.target as HTMLInputElement).value
    redrawTree()
  })
  for (const selector of ['[data-create-content]', '[data-create-root]']) {
    sidebar
      .querySelector<HTMLElement>(selector)
      ?.addEventListener('click', (event) => openCreateMenu(event.currentTarget as HTMLElement, { spaceId: space.id }))
  }
}

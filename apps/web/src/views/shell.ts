import type { Me, MySpaces, Space } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { spacePath } from '@/lib/space-types'
import { persistedStore } from '@/lib/store'
import { accountButton } from '@/ui/account-menu'
import { type IconName, icon } from '@/ui/icons'

export const collapsed = persistedStore('jiraia.sidebar.collapsed', false)
export const theme = persistedStore<'light' | 'dark' | null>('jiraia.theme', null)
export const spacesOpen = persistedStore('jiraia.sidebar.spaces-open', true)

/** Applies the stored theme, or follows the system's when nothing was chosen. */
export const applyTheme = (): void => {
  const chosen = theme.get()
  if (chosen) {
    document.documentElement.dataset.theme = chosen
  } else {
    delete document.documentElement.dataset.theme
  }
}

export const isDark = (): boolean =>
  theme.get() === 'dark' || (theme.get() === null && matchMedia('(prefers-color-scheme: dark)').matches)

/** A link of the sidebar; `count`, when there is something waiting there, shows beside its label. */
export const navItem = (href: string, label: string, name: IconName, path: string, count = 0) => html`
  <a class="nav-item ${path === href ? 'is-active' : ''}" href="${href}" ${path === href ? html`aria-current="page"` : ''} title="${label}${count ? ` (${count})` : ''}">
    ${icon(name)}<span class="nav-label">${label}</span>${count ? html`<span class="nav-count" aria-label="${count} pendentes">${count > 99 ? '99+' : count}</span>` : ''}
  </a>
`

type SpaceLink = { key: string; name: string }

/** One of the three lists under Espaços. A list with nothing in it says so, in one quiet line. */
const spaceSection = (title: string, name: IconName, spaces: readonly SpaceLink[], empty: string, path: string) => html`
  <div class="nav-sub" role="group" aria-label="${title}">
    <p class="nav-sub-title">${icon(name, 14)}<span>${title}</span></p>
    ${
      spaces.length === 0
        ? html`<p class="nav-sub-empty">${empty}</p>`
        : spaces.map(
            (space) => html`
              <a
                class="nav-sub-item ${path === spacePath(space.key) ? 'is-active' : ''}"
                href="${spacePath(space.key)}"
                ${path === spacePath(space.key) ? html`aria-current="page"` : ''}
              >${space.name}</a>
            `
          )
    }
  </div>
`

/**
 * Espaços, as a group: the arrow opens it, `+` creates a space, the gear manages them. Inside, the
 * caller's starred, recent and every space they can reach.
 */
const spacesGroup = (me: Me, mine: MySpaces, all: readonly Space[], path: string) => {
  const open = spacesOpen.get()

  return html`
    <div class="nav-group">
      <div class="nav-group-head ${path === '/espacos' ? 'is-active' : ''}">
        <button type="button" class="nav-group-label" data-toggle-spaces title="Espaços">
          ${icon('layoutGrid')}<span class="nav-label">Espaços</span>
        </button>
        <span class="nav-group-actions">
          ${canCreateSpaces(me) ? html`<button type="button" class="nav-action" data-new-space aria-label="Criar espaço" title="Criar espaço">${icon('plus', 16)}</button>` : ''}
          <a class="nav-action" href="/espacos" aria-label="Gerenciar espaços" title="Gerenciar espaços">${icon('settings', 16)}</a>
          <button type="button" class="nav-toggle" data-toggle-spaces aria-expanded="${open}" aria-controls="spaces-tree" aria-label="${open ? 'Recolher' : 'Expandir'} Espaços">
            ${icon('chevronRight', 14)}
          </button>
        </span>
      </div>
      <div id="spaces-tree" class="nav-tree" ${open ? '' : html`hidden`}>
        ${spaceSection('Marcados com estrela', 'starFilled', mine.starred, 'Nenhum espaço com estrela.', path)}
        ${spaceSection('Recentes', 'clock', mine.recent, 'Nenhum espaço aberto ainda.', path)}
        ${spaceSection('Todos os espaços', 'layoutGrid', all, 'Nenhum espaço criado ainda.', path)}
      </div>
    </div>
  `
}

/** JiraIA spaces are created by organization admins and space managers (ADR-0012). */
export const canCreateSpaces = (me: Me): boolean => me.isOrgAdmin || me.isSpaceManager

/** Search everything, or type a key to go straight to the card (escopo-mvp 3.6). `/` focuses it. */
const globalSearch = (path: string) => html`
  <form class="global-search" role="search" data-global-search>
    <label class="sr-only" for="global-search">Buscar cards ou ir para uma chave</label>
    <span class="global-search-icon" aria-hidden="true">${icon('search', 16)}</span>
    <input id="global-search" type="search" class="input" name="q" autocomplete="off" placeholder="Pesquisar"
      value="${path === '/busca' ? (new URLSearchParams(location.search).get('q') ?? '') : ''}" />
    <kbd class="kbd" aria-hidden="true">/</kbd>
    <button type="button" class="button button-ghost button-icon topbar-search-close" data-close-search aria-label="Fechar a busca">${icon('x')}</button>
  </form>
`

/**
 * A link to the other product, as Jira links to its apps: a small tile, the name, and the arrow that
 * says it opens in another tab (ADR-0010).
 */
export const productLink = (href: string, label: string, name: IconName) => html`
  <a class="nav-item nav-product" href="${href}" target="_blank" rel="noopener" title="${label} — abre em outra aba">
    <span class="nav-product-tile" aria-hidden="true">${icon(name, 14)}</span>
    <span class="nav-label">${label}</span>
    <span class="nav-product-out" aria-hidden="true">${icon('externalLink', 14)}</span>
  </a>
`

/**
 * A product's frame: a glass header across the top — the menu fold, the product grid, the brand and
 * the search — and a glass sidebar under it (ADR-0006). JiraIA and LET’S Draw AI each pass their brand
 * and navigation; the rest is the same.
 */
export const frame = (options: {
  me: Me
  brand: Html
  nav: Html
  path: string
  content: Html
  product: string
  /** Beside the search: JiraIA's "Criar"; LET’S Draw AI has none. */
  actions?: Html
  /** Unread notices, on the bell at the end of the header (escopo-mvp 4.6). */
  unread?: number
}) => html`
  <div class="shell ${collapsed.get() ? 'is-collapsed' : ''}" data-product="${options.product}">
    <header class="topbar glass">
      <div class="topbar-start">
        <button type="button" class="button button-ghost button-icon" data-collapse aria-label="Mostrar ou esconder o menu" aria-expanded="false" title="Menu">
          ${icon('sidebar')}
        </button>
        <button type="button" class="button button-ghost button-icon" data-apps aria-haspopup="menu" aria-expanded="false" aria-label="Trocar de produto" title="Produtos da LET’S">
          ${icon('gridDots')}
        </button>
        ${options.brand}
      </div>
      <div class="topbar-center">
        <button type="button" class="button button-ghost button-icon topbar-search-open" data-open-search aria-label="Pesquisar" title="Pesquisar">${icon('search')}</button>
        ${globalSearch(options.path)}
        ${options.actions ?? ''}
      </div>
      <div class="topbar-end">${bell(options.unread ?? 0)}${accountButton(options.me)}</div>
    </header>
    <aside class="sidebar glass" aria-label="Menu principal">
      <nav class="nav">${options.nav}</nav>
    </aside>
    <button type="button" class="sidebar-backdrop" data-close-drawer tabindex="-1" aria-label="Fechar o menu"></button>
    <main id="view" class="view">${options.content}</main>
  </div>
`

/** The notices bell: the count of what is unread, kept current by `refreshBell` between renders. */
export const bell = (unread: number) => html`
  <a class="button button-ghost button-icon bell" href="/notificacoes" data-bell aria-label="Notificações${unread ? `, ${unread} não lidas` : ''}" title="Notificações">
    ${icon('bell')}<span class="bell-count" data-bell-count ${unread ? '' : html`hidden`}>${unread > 99 ? '99+' : unread}</span>
  </a>
`

/** The products a person switches between from the grid in the header, as Jira lists its apps. */
export const appsMenu = (product: string) => html`
  <p class="draw-menu-title">Produtos</p>
  <a role="menuitem" href="/" ${product === 'jiraia' ? html`aria-current="page"` : ''}>${icon('kanban', 16)}JiraIA</a>
  <a role="menuitem" href="/draw" ${product === 'draw' ? html`aria-current="page"` : ''}>${icon('notebook', 16)}LET’S Draw AI</a>
`

/**
 * JiraIA's frame. Spaces live in the sidebar — starred, recent and all of them, under "Espaços" — and
 * the pages are another product, LET’S Draw AI, one click away (ADR-0010).
 */
export const shell = (
  me: Me,
  mine: MySpaces,
  all: readonly Space[],
  path: string,
  content: Html,
  unread = 0,
  proposals = 0
) =>
  frame({
    me,
    unread,
    path,
    content,
    product: 'jiraia',
    actions: html`<button type="button" class="button button-primary topbar-create" data-create-card-anywhere title="Criar card" aria-label="Criar">${icon('plus', 16)}<span class="topbar-create-label">Criar</span></button>`,
    brand: html`<a class="brand" href="/">Jira<span>IA</span></a>`,
    nav: html`
      <p class="nav-title">Navegação</p>
      ${navItem('/', 'Para você', 'home', path)}
      ${spacesGroup(me, mine, all, path)}
      ${navItem('/propostas', 'Propostas', 'gitPullRequest', path, proposals)}
      ${navItem('/grupos', 'Grupos', 'usersGroup', path)}
      ${navItem('/acessos', 'Acessos', 'lock', path.startsWith('/acessos') ? '/acessos' : path)}
      ${me.isOrgAdmin ? navItem('/pessoas', 'Pessoas', 'users', path) : ''}
      ${navItem('/integracoes', 'Integrações', 'bolt', path)}
      <hr class="nav-divider" />
      ${productLink('/draw', 'LET’S Draw AI', 'notebook')}
    `
  })

export const loadingView = html`<p class="muted" aria-busy="true">Carregando…</p>`

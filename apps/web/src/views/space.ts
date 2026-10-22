import { accessRead } from '@/api/access'
import { read, spaceIdByKey, visitSpace } from '@/api/requests'
import { withParams } from '@/lib/filters'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { SPACE_TYPE_LABEL, spacePath } from '@/lib/space-types'
import { accessPanel, bindAccessPanel } from '@/ui/access-panel'
import { automationsPanel, bindAutomationsPanel } from '@/ui/automations-panel'
import { bindFormsPanel, formsPanel } from '@/ui/forms-panel'
import { icon } from '@/ui/icons'
import { bindProposalPolicy, proposalPolicyPanel } from '@/ui/proposal-policy'
import { bindReportsPanel, reportsPanel } from '@/ui/reports-panel'
import { bindEditNotice, editNotice } from '@/ui/request-access'
import { openEditSpace } from '@/ui/space-dialogs'
import { starButton } from '@/ui/star'
import { toast } from '@/ui/toast'
import { bindWebhooksPanel, webhooksPanel } from '@/ui/webhooks-panel'

import { backlog, bindBacklog } from './backlog'
import { type BoardContext, bindBoard, board, loadBoard } from './board'
import { bindCardList, cardList } from './card-list'
import { bindFilterToolbar, type FilterState, filterToolbar, loadFilterState } from './space-filters'
import type { View } from './view'

/** The id behind the key in the address; a key the caller cannot see reads as "not found". */
const idOf = async (spaceKey: string): Promise<string> => {
  const id = await spaceIdByKey(spaceKey)
  if (!id) {
    throw { error: { code: 'NOT_FOUND', message: `Space ${spaceKey}` } }
  }
  return id
}

type Tab =
  | 'board'
  | 'lista'
  | 'backlog'
  | 'relatorios'
  | 'formularios'
  | 'automacoes'
  | 'webhooks'
  | 'agentes'
  | 'pessoas'

const TABS: {
  tab: Tab
  label: string
  icon: 'kanban' | 'list' | 'listDetails' | 'reportAnalytics' | 'forms' | 'bolt' | 'link' | 'robot' | 'users'
  admins?: true
}[] = [
  { tab: 'board', label: 'Board', icon: 'kanban' },
  { tab: 'lista', label: 'Lista', icon: 'list' },
  { tab: 'backlog', label: 'Backlog', icon: 'listDetails' },
  { tab: 'relatorios', label: 'Relatórios', icon: 'reportAnalytics' },
  { tab: 'formularios', label: 'Formulários', icon: 'forms' },
  { tab: 'automacoes', label: 'Automações', icon: 'bolt' },
  { tab: 'webhooks', label: 'Webhooks', icon: 'link', admins: true },
  { tab: 'agentes', label: 'Agentes', icon: 'robot', admins: true },
  { tab: 'pessoas', label: 'Pessoas e papéis', icon: 'users' }
]

/** A work tab keeps the filter and the view on screen; the other tabs have neither. */
const tabHref = (spaceKey: string, tab: Tab): string => {
  const params = new URLSearchParams(location.search)
  const keep = !isWork(tab)
    ? {}
    : { visao: params.get('visao') ?? undefined, filtro: params.get('filtro') ?? undefined }
  return withParams(spacePath(spaceKey), { aba: tab === 'board' ? undefined : tab, ...keep })
}

/** The webhooks tab says where the space's data goes: only its admins see it. */
const tabs = (spaceKey: string, current: Tab, manages: boolean) => html`
  <nav class="tabs space-tabs" aria-label="Seções do espaço">
    ${TABS.filter((each) => manages || !each.admins).map(
      ({ tab, label, icon: name }) =>
        html`<a class="tab" href="${tabHref(spaceKey, tab)}" ${current === tab ? html`aria-current="page"` : ''}>${icon(name, 16)}${label}</a>`
    )}
  </nav>
`

const currentTab = (): Tab => {
  const tab = new URLSearchParams(location.search).get('aba')
  return TABS.find((each) => each.tab === tab)?.tab ?? 'board'
}

/** Each work tab shows one set of cards in its own way (escopo-mvp 3.1, 3.2, 3.3). */
const WORK_TABS = {
  board: { draw: board, bind: bindBoard },
  lista: { draw: cardList, bind: bindCardList },
  backlog: { draw: backlog, bind: bindBacklog }
} as const

type WorkTab = keyof typeof WORK_TABS
const isWork = (tab: Tab): tab is WorkTab => tab in WORK_TABS

/** The tabs that are not cards: reports, intake forms, automations, and who holds which role. */
const SETTINGS_TABS = {
  relatorios: { draw: (spaceId: string) => reportsPanel(spaceId), bind: (root: HTMLElement) => bindReportsPanel(root) },
  formularios: { draw: formsPanel, bind: bindFormsPanel },
  automacoes: { draw: automationsPanel, bind: bindAutomationsPanel },
  webhooks: { draw: (spaceId: string) => webhooksPanel(spaceId), bind: bindWebhooksPanel },
  agentes: { draw: (spaceId: string) => proposalPolicyPanel(spaceId), bind: bindProposalPolicy },
  pessoas: {
    draw: (spaceId: string) => accessPanel('jiraia', spaceId),
    bind: (root: HTMLElement, spaceId: string) => bindAccessPanel(root, 'jiraia', spaceId)
  }
} as const

/** The open tab's content: a work tab over the filtered cards, or one of the space's settings. */
const tabContent = async (tab: Tab, spaceId: string, manages: boolean): Promise<Html> =>
  context && filters && isWork(tab)
    ? html`${filterToolbar(filters, context, tab)}${WORK_TABS[tab].draw(context)}`
    : await SETTINGS_TABS[tab as keyof typeof SETTINGS_TABS].draw(spaceId, manages)

/** The board context and the filter on screen, kept for `bind` — render reads them, bind wires them. */
let context: BoardContext | undefined
let filters: FilterState | undefined

/** The work tab's context: the cards a filter or a saved view lets through (3.4, 3.5). */
const loadWork = async (spaceId: string) => {
  filters = await loadFilterState(spaceId)
  const loaded = await loadBoard(spaceId, filters.filter)
  return { ...loaded, filtered: Object.keys(filters.filter).length > 0 }
}

/** One space, addressed by its key: its board, and who holds which role (1.1, 1.3, 3.1). */
export const spaceView: View = {
  path: '/espacos/:spaceKey',
  skeleton: 'board',
  title: 'Espaço',
  enter: async ({ spaceKey = '' }) => await visitSpace(await idOf(spaceKey)),
  render: async ({ spaceKey = '' }) => {
    const spaceId = await idOf(spaceKey)
    const [me, mine, space, access, notice] = await Promise.all([
      read.me(),
      read.mySpaces(),
      read.space(spaceId),
      accessRead.mine('jiraia', spaceId),
      editNotice('jiraia', spaceId)
    ])
    // What the caller may do here: the strongest of their roles, their groups' and the reader floor (ADR-0012).
    const { canManage: manages, canWrite } = access
    const starred = mine.starred.some((each) => each.id === space.id)
    const tab = currentTab()
    const loaded = isWork(tab) ? await loadWork(spaceId) : undefined
    context = loaded ? { spaceId, spaceKey: space.key, meId: me.id, canWrite, manages, ...loaded } : undefined

    return html`
      <header class="page-header">
        <div class="row">
          <span class="key">${space.key}</span>
          <h1>${space.name}</h1>
          ${starButton({ id: space.id, name: space.name, starred })}
          ${manages ? html`<button type="button" class="button button-ghost" data-edit-space>${icon('pencil', 16)}Editar</button>` : ''}
        </div>
        <p class="muted">${SPACE_TYPE_LABEL[space.type]} · Líder: ${space.lead?.name ?? 'sem líder'}${space.description ? html` · ${space.description}` : ''}</p>
      </header>
      ${notice}
      ${tabs(space.key, tab, manages)}
      ${await tabContent(tab, spaceId, manages)}
    `
  },
  bind: (root, { spaceKey = '' }) => {
    const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
    const withId = (act: (spaceId: string) => Promise<unknown>) => () => void idOf(spaceKey).then(act).catch(refuse)

    root.querySelector('[data-edit-space]')?.addEventListener(
      'click',
      withId(async (id) => openEditSpace(await read.space(id)))
    )
    const tab = currentTab()
    withId(async (id) => bindEditNotice(root, 'jiraia', id))()
    if (context && filters && isWork(tab)) {
      bindFilterToolbar(root, filters, context, tab)
      WORK_TABS[tab].bind(root, context)
      return
    }
    withId(async (id) => SETTINGS_TABS[tab as keyof typeof SETTINGS_TABS].bind(root, id))()
  }
}

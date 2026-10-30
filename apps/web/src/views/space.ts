import { accessRead } from '@/api/access'
import { read, spaceIdByKey, visitSpace } from '@/api/requests'
import { withParams } from '@/lib/filters'
import { type Html, html } from '@/lib/html'
import { DONE_SINCE, hidesOldDone } from '@/lib/old-done'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { movedTab, settingsPath } from '@/lib/space-settings'
import { SPACE_TYPE_LABEL, spacePath } from '@/lib/space-types'
import { icon } from '@/ui/icons'
import { bindReportsPanel, reportsPanel } from '@/ui/reports-panel'
import { bindEditNotice, editNotice } from '@/ui/request-access'
import { starButton } from '@/ui/star'
import { toast } from '@/ui/toast'

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

type Tab = 'board' | 'lista' | 'backlog' | 'relatorios'

const TABS: {
  tab: Tab
  label: string
  icon: 'kanban' | 'list' | 'listDetails' | 'reportAnalytics'
}[] = [
  { tab: 'board', label: 'Board', icon: 'kanban' },
  { tab: 'lista', label: 'Lista', icon: 'list' },
  { tab: 'backlog', label: 'Backlog', icon: 'listDetails' },
  { tab: 'relatorios', label: 'Relatórios', icon: 'reportAnalytics' }
]

/** A work tab keeps the filter and the view on screen; the other tabs have neither. */
const tabHref = (spaceKey: string, tab: Tab): string => {
  const params = new URLSearchParams(location.search)
  const keep = !isWork(tab)
    ? {}
    : { visao: params.get('visao') ?? undefined, filtro: params.get('filtro') ?? undefined }
  return withParams(spacePath(spaceKey), { aba: tab === 'board' ? undefined : tab, ...keep })
}

/** The space's work; what sets it up is in its settings (ADR-0031). */
const tabs = (spaceKey: string, current: Tab) => html`
  <nav class="tabs space-tabs" aria-label="Seções do espaço">
    ${TABS.map(
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

/** The open tab's content: a work tab over the filtered cards, or the reports. */
const tabContent = async (tab: Tab, spaceId: string): Promise<Html> =>
  context && filters && isWork(tab)
    ? html`${filterToolbar(filters, context, tab)}${WORK_TABS[tab].draw(context)}`
    : await reportsPanel(spaceId)

/** The board context and the filter on screen, kept for `bind` — render reads them, bind wires them. */
let context: BoardContext | undefined
let filters: FilterState | undefined

/** The work tab's context: the cards a filter or a saved view lets through (3.4, 3.5). */
const loadWork = async (spaceId: string, tab: WorkTab) => {
  filters = await loadFilterState(spaceId)
  // Only the Lista leaves out the cards done long ago (ADR-0040).
  const hides = tab === 'lista' && hidesOldDone(filters.filter, location.search)
  const loaded = await loadBoard(spaceId, filters.filter, hides ? DONE_SINCE : undefined)
  return { ...loaded, filtered: Object.keys(filters.filter).length > 0 }
}

/** One space, addressed by its key: its board, and who holds which role (1.1, 1.3, 3.1). */
export const spaceView: View = {
  path: '/espacos/:spaceKey',
  skeleton: 'board',
  title: 'Espaço',
  enter: async ({ spaceKey = '' }) => await visitSpace(await idOf(spaceKey)),
  render: async ({ spaceKey = '' }) => {
    // A tab that moved into the settings keeps its old address working (ADR-0031).
    const moved = movedTab(spaceKey, new URLSearchParams(location.search).get('aba'))
    if (moved) {
      navigate(moved, true)
      return html``
    }
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
    const loaded = isWork(tab) ? await loadWork(spaceId, tab) : undefined
    context = loaded ? { spaceId, spaceKey: space.key, meId: me.id, canWrite, manages, ...loaded } : undefined

    return html`
      <header class="page-header">
        <div class="row">
          <span class="key">${space.key}</span>
          <h1>${space.name}</h1>
          ${starButton({ id: space.id, name: space.name, starred })}
          <a class="button button-ghost" href="${settingsPath(space.key)}">${icon('settings', 16)}Configurações</a>
        </div>
        <p class="muted">${SPACE_TYPE_LABEL[space.type]} · Líder: ${space.lead?.name ?? 'sem líder'}${space.description ? html` · ${space.description}` : ''}</p>
      </header>
      ${notice}
      ${tabs(space.key, tab)}
      ${await tabContent(tab, spaceId)}
    `
  },
  bind: (root, { spaceKey = '' }) => {
    const refuse = (refusal: unknown) => toast(refusalSentence(refusal), 'error')
    const withId = (act: (spaceId: string) => Promise<unknown>) => () => void idOf(spaceKey).then(act).catch(refuse)

    const tab = currentTab()
    withId(async (id) => bindEditNotice(root, 'jiraia', id))()
    if (context && filters && isWork(tab)) {
      bindFilterToolbar(root, filters, context, tab)
      WORK_TABS[tab].bind(root, context)
      return
    }
    bindReportsPanel(root)
  }
}

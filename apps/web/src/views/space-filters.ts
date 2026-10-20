import { read, type SavedView } from '@/api/requests'
import { type CardFilter, readFilter, sameFilter, withoutSpaces } from '@/lib/filters'
import { type Html, html } from '@/lib/html'
import { navigate } from '@/lib/router'
import { bindFilterPicker, filterPicker } from '@/ui/filter-bar'
import { bindViewMenu, type Layout, type ViewMenuContext, viewMenu, viewPath } from '@/ui/view-menu'

import { type BoardContext, laneOf, setLanes } from './board'
import { columnsOf, setColumns } from './card-list'

/** What the address says about the cards on screen: a saved view, a filter, or both (3.4, 3.5). */
export type FilterState = {
  views: readonly SavedView[]
  view: SavedView | undefined
  filter: CardFilter
  /** The filter on screen is not the view's any more — it can be saved over it. */
  changed: boolean
}

/**
 * `?visao=` opens a saved view; `?filtro=` is the filter on screen, which wins over the view's own
 * while someone edits it. In a space the view runs on that space's cards only.
 */
export const loadFilterState = async (spaceId: string): Promise<FilterState> => {
  const views = (await read.views(spaceId)).items
  const params = new URLSearchParams(location.search)
  const view = views.find((each) => each.id === params.get('visao'))
  const own = view ? withoutSpaces(view.filter) : {}
  const typed = params.has('filtro') ? readFilter(location.search) : undefined
  return {
    views,
    view,
    filter: typed ?? own,
    changed: view !== undefined && typed !== undefined && !sameFilter(typed, own)
  }
}

const LAYOUT_OF: Record<string, Layout> = { board: 'board', lista: 'list', backlog: 'backlog' }

const menuContext = (state: FilterState, board: BoardContext, tab: string): ViewMenuContext => ({
  ...state,
  spaceId: board.spaceId,
  spaceKey: board.spaceKey,
  canWrite: board.canWrite,
  layout: LAYOUT_OF[tab] ?? 'list',
  lanes: laneOf(board.spaceId),
  columns: columnsOf(board.spaceId)
})

/** The filter and the saved views, above whichever work tab is open. */
export const filterToolbar = (state: FilterState, board: BoardContext, tab: string): Html => html`
  <div class="toolbar filter-toolbar">
    ${filterPicker({ ...board, filter: state.filter })}
    <span class="toolbar-spacer"></span>
    ${viewMenu(menuContext(state, board, tab))}
  </div>
`

export const bindFilterToolbar = (root: HTMLElement, state: FilterState, board: BoardContext, tab: string): void => {
  bindFilterPicker(root, { ...board, filter: state.filter })
  bindViewMenu(root, menuContext(state, board, tab), (view) => {
    if (view) {
      setLanes(board.spaceId, view.lanes)
      if (view.columns.length > 0) {
        setColumns(board.spaceId, view.columns)
      }
    }
    navigate(viewPath(board.spaceKey, view))
  })
}

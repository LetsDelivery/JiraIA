import { type SavedView, write } from '@/api/requests'
import { type CardFilter, isEmpty, withParams } from '@/lib/filters'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { navigate } from '@/lib/router'
import { spacePath } from '@/lib/space-types'

import { openFormDialog, textField } from './dialog'
import { viewLabel } from './filter-bar'
import { icon } from './icons'
import { selectField } from './select'
import { toast } from './toast'

export type Layout = SavedView['layout']
export type Lanes = SavedView['lanes']

export type ViewMenuContext = {
  spaceId: string
  spaceKey: string
  canWrite: boolean
  views: readonly SavedView[]
  /** The view named in the address, when there is one. */
  view: SavedView | undefined
  filter: CardFilter
  /** Whether the filter on screen differs from the view's. */
  changed: boolean
  layout: Layout
  lanes: Lanes
  columns: readonly string[]
}

/** The `?aba=` a layout opens on: the board is the space's first tab, so it needs none. */
const TAB_OF: Record<Layout, string | undefined> = { board: undefined, list: 'lista', backlog: 'backlog' }

export const viewPath = (spaceKey: string, view: SavedView | undefined): string =>
  withParams(spacePath(spaceKey), { visao: view?.id, aba: view ? TAB_OF[view.layout] : undefined })

/** Saved views (escopo-mvp 3.5): pick one, save the filter on screen as one, update or delete it. */
export const viewMenu = (context: ViewMenuContext): Html => {
  const { view, filter, changed } = context
  const options = [
    { value: '', label: 'Visões salvas' },
    ...context.views.map((each) => ({ value: each.id, label: viewLabel(each) }))
  ]
  return html`
    ${selectField({ name: 'view', label: 'Visão salva', visibleLabel: false, options, value: view?.id ?? '', attributes: html`data-view-select` })}
    ${!isEmpty(filter) && (!view || changed) ? html`<button type="button" class="button button-secondary" data-save-view>${icon('bookmark', 16)}Salvar visão</button>` : ''}
    ${view?.canEdit && changed ? html`<button type="button" class="button button-secondary" data-update-view>Atualizar visão</button>` : ''}
    ${view?.canEdit ? html`<button type="button" class="button button-ghost button-icon" data-delete-view aria-label="Excluir visão ${view.name}" title="Excluir visão">${icon('trash', 16)}</button>` : ''}
  `
}

export const bindViewMenu = (root: HTMLElement, context: ViewMenuContext, choose: (view?: SavedView) => void) => {
  root.querySelector('[data-view-select]')?.addEventListener('select-change', (event) => {
    const id = (event as CustomEvent<{ value: string }>).detail.value
    choose(context.views.find((each) => each.id === id))
  })
  root.querySelector('[data-save-view]')?.addEventListener('click', () => saveView(context))
  root.querySelector('[data-update-view]')?.addEventListener('click', () => void updateView(context))
  root.querySelector('[data-delete-view]')?.addEventListener('click', () => void deleteView(context))
}

const SCOPES = [
  { value: 'personal', label: 'Só para mim', hint: 'Aparece só na sua lista de visões' },
  { value: 'space', label: 'Para o espaço', hint: 'Todo mundo que lê o espaço vê a visão' }
]

const saveView = (context: ViewMenuContext): void => {
  openFormDialog({
    title: 'Salvar visão',
    submit: 'Salvar',
    done: 'Visão salva.',
    fields: html`
      ${textField({ name: 'name', label: 'Nome', required: true, maxLength: 80, placeholder: 'Ex.: Bloqueados' })}
      ${selectField({ name: 'scope', label: 'Quem vê', options: context.canWrite ? SCOPES : SCOPES.slice(0, 1), value: 'personal' })}
    `,
    onSubmit: async (data) => {
      const view = await write.createView(context.spaceId, {
        name: String(data.get('name')).trim(),
        scope: String(data.get('scope')) === 'space' ? 'space' : 'personal',
        spaceId: context.spaceId,
        filter: { ...context.filter, spaceIds: [context.spaceId] },
        layout: context.layout,
        lanes: context.lanes,
        columns: [...context.columns]
      })
      navigate(viewPath(context.spaceKey, view), true)
    }
  })
}

/** The view keeps the spaces it looked across; only the conditions on screen replace its own. */
const updateView = async (context: ViewMenuContext): Promise<void> => {
  const view = context.view
  if (!view) {
    return
  }
  const filter = { ...context.filter, spaceIds: view.filter.spaceIds ?? [context.spaceId] }
  await write
    .updateView(context.spaceId, view.id, { filter, layout: context.layout, lanes: context.lanes })
    .then(() => {
      toast('Visão atualizada.')
      navigate(viewPath(context.spaceKey, view), true)
    })
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
}

const deleteView = async (context: ViewMenuContext): Promise<void> => {
  const view = context.view
  if (!view || !confirm(`Excluir a visão "${view.name}"?`)) {
    return
  }
  await write
    .deleteView(context.spaceId, view.id)
    .then(() => {
      toast('Visão excluída.')
      navigate(viewPath(context.spaceKey, undefined), true)
    })
    .catch((refusal: unknown) => toast(refusalSentence(refusal), 'error'))
}

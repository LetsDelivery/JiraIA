import { type Dashboard, type Report, reportsRead, reportsWrite, type Widget } from '@/api/reports'
import { read, type SavedView } from '@/api/requests'
import { type Html, html } from '@/lib/html'
import { refusalSentence } from '@/lib/refusal'
import { moveWidget, shiftWidget, titleOf } from '@/lib/reports'

import { bindTips } from './charts'
import { openFormDialog } from './dialog'
import { icon } from './icons'
import { widgetBody, widgetFrame } from './report-widgets'
import { toast } from './toast'
import { openCatalog, openWidgetEditor } from './widget-editor'

/**
 * The Relatórios tab of a space (Etapa 5d, ADR-0016): every reader sees its widgets; its admins edit
 * a draft of the dashboard — add, change, reorder, remove — and save it whole, or put it back.
 */
type State = {
  spaceId: string
  dashboard: Dashboard
  views: SavedView[]
  /** The widgets being edited; `null` while the dashboard is only shown. */
  draft: Widget[] | null
}

let state: State | undefined

/** Each widget's data by what it asks, so reordering or resizing the draft asks nothing again. */
const reports = new Map<string, Promise<Report>>()
const pages = new Map<string, number>()

const askFor = (spaceId: string, widget: Widget): Promise<Report> => {
  const { title: _title, width: _width, ...asked } = widget
  const page = pages.get(widget.id) ?? 1
  const key = JSON.stringify({ spaceId, asked, page })
  const known = reports.get(key) ?? reportsRead.run(spaceId, widget, page)
  reports.set(key, known)
  known.catch(() => reports.delete(key))
  return known
}

export const reportsPanel = async (spaceId: string): Promise<Html> => {
  const [dashboard, views] = await Promise.all([reportsRead.dashboard(spaceId), read.views(spaceId)])
  const shared = views.items.filter((view) => view.scope === 'space' && view.spaceId === spaceId)
  const draft = state?.spaceId === spaceId ? state.draft : null
  state = { spaceId, dashboard, views: shared, draft }
  // A fresh render reads fresh numbers: a card may have moved since the tab was last open.
  reports.clear()
  return html`<section class="section reports" data-reports>${_content(state)}</section>`
}

const _actions = (current: State): Html => {
  if (current.draft) {
    return html`
      <button type="button" class="button button-secondary" data-add-widget>${icon('plus', 16)}Adicionar widget</button>
      ${current.dashboard.isDefault ? '' : html`<button type="button" class="button button-ghost" data-restore>${icon('restore', 16)}Restaurar padrão</button>`}
      <button type="button" class="button button-ghost" data-cancel>Cancelar</button>
      <button type="button" class="button button-primary" data-save>Salvar painel</button>
    `
  }
  return current.dashboard.canEdit
    ? html`<button type="button" class="button button-secondary" data-edit-dashboard>${icon('pencil', 16)}Editar painel</button>`
    : html``
}

const _content = (current: State): Html => {
  const widgets = current.draft ?? current.dashboard.widgets
  const viewName = (widget: Widget) => current.views.find((view) => view.id === widget.viewId)?.name
  return html`
    <div class="section-head">
      <div>
        <h2>Relatórios</h2>
        <p class="muted">${current.draft ? 'Editando o painel: arraste os widgets para reordenar. Nada muda para a equipe até salvar.' : 'O andamento do espaço: o que entra, o que sai, onde está e quanto tempo leva.'}</p>
      </div>
      <div class="row">${_actions(current)}</div>
    </div>
    ${
      widgets.length
        ? html`<div class="widget-grid ${current.draft ? 'is-editing' : ''}">${widgets.map((widget) => widgetFrame(widget, Boolean(current.draft), viewName(widget)))}</div>`
        : html`<div class="empty"><p class="empty-title">Nenhum widget</p><p class="muted">${current.dashboard.canEdit ? 'Adicione widgets para acompanhar o espaço.' : 'Quem administra o espaço pode montar o painel.'}</p></div>`
    }
  `
}

/** Draws one widget's body from its data, or says why it could not. */
const _fill = async (frame: HTMLElement, widget: Widget, spaceId: string): Promise<void> => {
  const body = frame.querySelector<HTMLElement>('[data-widget-body]')
  if (!body) {
    return
  }
  try {
    const report = await askFor(spaceId, widget)
    body.innerHTML = widgetBody(widget, report, body.clientWidth).value
  } catch (refusal) {
    body.innerHTML = html`<p class="widget-empty error">${refusalSentence(refusal)}</p>`.value
  }
  body.removeAttribute('aria-busy')
}

const _widgets = (): Widget[] => state?.draft ?? state?.dashboard.widgets ?? []

/** Every widget asks for its data on its own, so a slow one holds up nothing else. */
const _fillAll = (section: HTMLElement): void => {
  for (const widget of _widgets()) {
    const frame = section.querySelector<HTMLElement>(`[data-widget="${widget.id}"]`)
    if (frame && state) {
      void _fill(frame, widget, state.spaceId)
    }
  }
}

const _redraw = (section: HTMLElement): void => {
  if (state) {
    section.innerHTML = _content(state).value
    _fillAll(section)
  }
}

const _setDraft = (section: HTMLElement, draft: Widget[] | null): void => {
  if (state) {
    state.draft = draft
    _redraw(section)
  }
}

const _save = async (section: HTMLElement): Promise<void> => {
  if (!state?.draft) {
    return
  }
  const { spaceId, draft } = state
  state.draft = null
  try {
    await reportsWrite.save(spaceId, draft)
    toast('Painel salvo.')
  } catch (refusal) {
    _setDraft(section, draft)
    throw refusal
  }
}

const _restore = (spaceId: string): void =>
  openFormDialog({
    title: 'Restaurar o painel padrão',
    submit: 'Restaurar padrão',
    done: 'Painel padrão restaurado.',
    fields: html`<p class="muted">Os widgets deste espaço voltam a ser os do painel padrão, para toda a equipe.</p>`,
    onSubmit: async () => {
      if (state) {
        state.draft = null
      }
      await reportsWrite.restore(spaceId)
    }
  })

/** A widget's own controls while editing: move, change, remove. */
const _onWidget = (section: HTMLElement, target: HTMLElement, id: string): void => {
  const draft = state?.draft
  const widget = draft?.find((each) => each.id === id)
  if (!state || !draft || !widget) {
    return
  }
  const shift = target.closest<HTMLElement>('[data-shift]')?.dataset.shift
  if (shift) {
    _setDraft(section, shiftWidget(draft, id, shift === '1' ? 1 : -1))
  } else if (target.closest('[data-remove-widget]')) {
    _setDraft(
      section,
      draft.filter((each) => each.id !== id)
    )
    toast(`${titleOf(widget)} saiu do painel. Salve para manter.`)
  } else if (target.closest('[data-edit-widget]')) {
    const replace = (changed: Widget) =>
      _setDraft(
        section,
        draft.map((each) => (each.id === id ? changed : each))
      )
    openWidgetEditor({ widget, isNew: false, views: state.views, onDone: replace })
  }
}

const _onPage = (target: HTMLElement): void => {
  const page = Number(target.closest<HTMLElement>('[data-page]')?.dataset.page)
  const frame = target.closest<HTMLElement>('[data-widget]')
  const widget = _widgets().find((each) => each.id === frame?.dataset.widget)
  if (frame && widget && state && page >= 1) {
    pages.set(widget.id, page)
    void _fill(frame, widget, state.spaceId)
  }
}

const _add = (section: HTMLElement, current: State): void => {
  const add = (widget: Widget) => _setDraft(section, [...(current.draft ?? []), widget])
  openCatalog((widget) => openWidgetEditor({ widget, isNew: true, views: current.views, onDone: add }))
}

/** The dashboard's own buttons, by the attribute that marks each. */
const ACTIONS: [string, (section: HTMLElement, current: State) => unknown][] = [
  ['[data-edit-dashboard]', (section, current) => _setDraft(section, structuredClone(current.dashboard.widgets))],
  ['[data-add-widget]', _add],
  ['[data-cancel]', (section) => _setDraft(section, null)],
  ['[data-save]', (section) => _save(section)],
  ['[data-restore]', (_section, current) => _restore(current.spaceId)]
]

const _onClick = async (section: HTMLElement, target: HTMLElement): Promise<void> => {
  const frame = target.closest<HTMLElement>('[data-widget]')
  if (!state) {
    return
  }
  if (target.closest('[data-page]')) {
    return _onPage(target)
  }
  if (frame?.dataset.widget && target.closest('.widget-tools')) {
    return _onWidget(section, target, frame.dataset.widget)
  }
  const action = ACTIONS.find(([selector]) => target.closest(selector))
  await action?.[1](section, state)
}

/** Drag a widget over another to put it before that one; drop on the empty end of the grid to put it last. */
const _bindDrag = (section: HTMLElement): void => {
  let dragged: string | undefined
  section.addEventListener('dragstart', (event) => {
    dragged = (event.target as HTMLElement).closest<HTMLElement>('[data-widget]')?.dataset.widget
    event.dataTransfer?.setData('text/plain', dragged ?? '')
  })
  section.addEventListener('dragover', (event) => {
    if (dragged && state?.draft) {
      event.preventDefault()
    }
  })
  section.addEventListener('drop', (event) => {
    event.preventDefault()
    const over = (event.target as HTMLElement).closest<HTMLElement>('[data-widget]')?.dataset.widget ?? null
    if (dragged && state?.draft && over !== dragged) {
      _setDraft(section, moveWidget(state.draft, dragged, over))
    }
    dragged = undefined
  })
}

/** Charts over time are drawn to their width: a resized body is drawn again from the data it has. */
const _bindResize = (section: HTMLElement): void => {
  let last = section.clientWidth
  new ResizeObserver(() => {
    if (Math.abs(section.clientWidth - last) > 24) {
      last = section.clientWidth
      _fillAll(section)
    }
  }).observe(section)
}

export const bindReportsPanel = (root: HTMLElement): void => {
  const section = root.querySelector<HTMLElement>('[data-reports]')
  if (!section) {
    return
  }
  bindTips(section)
  _bindDrag(section)
  _bindResize(section)
  section.addEventListener('click', (event) => {
    void _onClick(section, event.target as HTMLElement).catch((refusal) => toast(refusalSentence(refusal), 'error'))
  })
  _fillAll(section)
}
